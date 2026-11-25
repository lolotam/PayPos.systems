import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { transactionWriters } from '../../../shared/adapters/transaction-writers.ts';
import type { StatementExportScope } from '../domain/statement-export-scope.ts';
import type {
  StatementExportBinding,
  StatementExportCollectContext,
  StatementExportReaderResult,
  StatementExportRequestContext,
  StatementExportRow,
  StatementExportScopeIds,
  StatementExportTransactions,
} from '../ports/statement-export.port.ts';

/**
 * القراءات اللي بتيجي من وحدات تانية ومربوطة في جذر التطبيق: النطاق الفعّال من identity (نفس شكل نتيجته)،
 * وتفعيل الميزة، وعضوية الطالب. الوحدة بتاخدهم على معاملتها من غير ما تستورد حد.
 */
export interface StatementExportReaders {
  scope(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<
    | {
        readonly kind: 'scope';
        readonly scope: { readonly businessWide: boolean; readonly branchIds: readonly string[] };
      }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'feature_disabled' }
  >;
  featureEnabled(tx: Tx, companyId: string): Promise<boolean>;
  requesterMembership(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<string | null>;
}

interface ExportRow extends Record<string, unknown> {
  id: string;
  statement_id: string;
  period: string;
  business_id: string;
  language: string;
  scope: string;
  branch_ids: string[] | null;
  employee_ids: string[] | null;
  collected_at: Date | string | null;
}

/**
 * معاملات طلب التصدير وتحميله: كل واحدة معاملة مستأجر واحدة بالمستخدم، وكل القراءات والكتابة بتتشارك فيها.
 *
 * @param database واجهات الداتابيز اللي بتفتح معاملة المستأجر
 * @param ids مولّد معرّفات سجل التدقيق
 * @param readers القراءات المربوطة في جذر التطبيق
 * @returns المعاملتان
 */
export function createStatementExportTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
  readers: StatementExportReaders,
): StatementExportTransactions {
  return {
    request: (scope, work) =>
      database.withTenant(scope.companyId, (tx) => work(requestContext(tx, scope, readers)), {
        userId: scope.userId,
      }),
    collect: (scope, work) =>
      database.withTenant(scope.companyId, (tx) => work(collectContext(tx, scope, readers, ids)), {
        userId: scope.userId,
      }),
  };
}

async function readerScope(
  tx: Tx,
  scope: StatementExportScopeIds,
  readers: StatementExportReaders,
): Promise<StatementExportReaderResult> {
  const found = await readers.scope(tx, scope.companyId, scope.userId, scope.businessId);
  if (found.kind !== 'scope') return found;
  if (!(await readers.featureEnabled(tx, scope.companyId))) return { kind: 'feature_disabled' };
  return { kind: 'scope', ...found.scope };
}

async function frozenEmployees(tx: Tx, companyId: string, statementId: string) {
  const rows = await tx.execute<{ employee_id: string; attached_branch_ids: string[] }>(sql`
    SELECT employee_id, attached_branch_ids FROM commission_statement_lines
    WHERE company_id = ${companyId} AND statement_id = ${statementId} AND kind = 'EMPLOYEE'`);
  return rows.map((row) => ({
    employeeId: row.employee_id,
    attachedBranchIds: row.attached_branch_ids,
  }));
}

function requestContext(
  tx: Tx,
  scope: StatementExportScopeIds,
  readers: StatementExportReaders,
): StatementExportRequestContext {
  return {
    reader: () => readerScope(tx, scope, readers),
    statement: async (period) => {
      const [row] = await tx.execute<{ id: string; status: string }>(sql`
        SELECT id, status FROM commission_statements
        WHERE company_id = ${scope.companyId} AND business_id = ${scope.businessId} AND period = ${period}`);
      return row === undefined ? null : { id: row.id, status: row.status };
    },
    frozenEmployees: (statementId) => frozenEmployees(tx, scope.companyId, statementId),
    requesterMembership: () =>
      readers.requesterMembership(tx, scope.companyId, scope.userId, scope.businessId),
    insert: (row) => insertRequest(tx, scope.companyId, row),
  };
}

function uuidArray(values: readonly string[]) {
  if (values.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

async function insertRequest(tx: Tx, companyId: string, row: StatementExportRow): Promise<void> {
  const branchIds =
    row.scope.kind === 'BRANCHES' ? uuidArray(row.scope.branchIds) : sql`NULL::uuid[]`;
  const employeeIds =
    row.scope.kind === 'BRANCHES' ? uuidArray(row.scope.employeeIds) : sql`NULL::uuid[]`;
  await tx.execute(sql`
    INSERT INTO commission_statement_exports (
      company_id, id, render_id, business_id, statement_id, period, requested_by, requested_membership_id,
      scope, branch_ids, employee_ids, language, requested_at
    ) VALUES (
      ${companyId}, ${row.id}, ${row.renderId}, ${row.businessId}, ${row.statementId}, ${row.period},
      ${row.requestedBy}, ${row.requestedMembershipId}, ${row.scope.kind}, ${branchIds}, ${employeeIds},
      ${row.language}, ${row.requestedAt.toISOString()}::timestamptz
    )`);
}

function collectContext(
  tx: Tx,
  scope: StatementExportScopeIds,
  readers: StatementExportReaders,
  ids: IdGenerator,
): StatementExportCollectContext {
  return {
    binding: (renderId, period) => bindingRow(tx, scope, renderId, period),
    reader: () => readerScope(tx, scope, readers),
    frozenEmployees: (statementId) => frozenEmployees(tx, scope.companyId, statementId),
    markCollected: async (exportId, at) => {
      await tx.execute(sql`
        UPDATE commission_statement_exports SET collected_at = ${at.toISOString()}::timestamptz
        WHERE company_id = ${scope.companyId} AND id = ${exportId}`);
    },
    audit: transactionWriters(tx, ids).audit,
  };
}

async function bindingRow(
  tx: Tx,
  scope: StatementExportScopeIds,
  renderId: string,
  period: string,
): Promise<StatementExportBinding | null> {
  const [row] = await tx.execute<ExportRow>(sql`
    SELECT id, statement_id, period, business_id, language, scope, branch_ids, employee_ids, collected_at
    FROM commission_statement_exports
    WHERE company_id = ${scope.companyId} AND render_id = ${renderId}::uuid
      AND business_id = ${scope.businessId} AND period = ${period} AND requested_by = ${scope.userId}
    FOR UPDATE`);
  if (row === undefined) return null;
  const saved: StatementExportScope =
    row.scope === 'BUSINESS'
      ? { kind: 'BUSINESS' }
      : { kind: 'BRANCHES', branchIds: row.branch_ids ?? [], employeeIds: row.employee_ids ?? [] };
  return {
    id: row.id,
    statementId: row.statement_id,
    period: row.period,
    businessId: row.business_id,
    language: row.language === 'en' ? 'en' : 'ar',
    scope: saved,
    collectedAt: row.collected_at === null ? null : new Date(row.collected_at),
  };
}
