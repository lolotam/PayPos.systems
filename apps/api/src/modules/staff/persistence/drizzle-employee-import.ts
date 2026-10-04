import {
  appendAuditLog,
  appendOutboxEvent,
  runIdempotent,
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  type IdGenerator,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql } from 'drizzle-orm';

import { documentFileFacts } from '../../files/index.ts';
import { lockEmployeeManagementAccess } from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';
import type { EmployeeRecord } from '../domain/create-employee.ts';
import {
  EmployeeImportError,
  type EmployeeImportCandidate,
  type EmployeeImportFileFacts,
  type EmployeeImportRowError,
} from '../domain/employee-import.ts';
import type {
  EmployeeImportTransactions,
  ImportBranch,
  ImportCommitScope,
  ImportPreviewScope,
  SaveImportPreviewInput,
  StoredImportPreview,
} from '../ports/employee-import.port.ts';

async function authorize(
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
): Promise<boolean> {
  const decision = await lockEmployeeManagementAccess(tx, companyId, userId, businessId);
  if (!decision.manage) return false;
  if (!decision.featureEnabled) throw new EmployeeImportError('FEATURE_DISABLED');
  return true;
}

async function branches(tx: Tx, businessId: string): Promise<readonly ImportBranch[]> {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  const business = tree?.businesses.find((candidate) => candidate.id === businessId);
  return (
    business?.branches.map((branch) => ({
      id: branch.id,
      name_en: branch.name_en,
      name_ar: branch.name_ar,
    })) ?? []
  );
}

function previewScope(tx: Tx, companyId: string, userId: string): ImportPreviewScope {
  return {
    authorize: (businessId) => authorize(tx, companyId, userId, businessId),
    fileFacts: (fileId): Promise<EmployeeImportFileFacts | null> =>
      documentFileFacts(tx, companyId, fileId) as Promise<EmployeeImportFileFacts | null>,
    branches: (businessId) => branches(tx, businessId),
    save: (input: SaveImportPreviewInput) => savePreview(tx, companyId, userId, input),
  };
}

function commitScope(tx: Tx, companyId: string, userId: string, ids: IdGenerator): ImportCommitScope {
  return {
    authorize: (businessId) => authorize(tx, companyId, userId, businessId),
    load: (previewId) => loadPreview(tx, companyId, previewId),
    branches: (businessId) => branches(tx, businessId),
    insert: (records) => insertEmployees(tx, companyId, ids, records),
    summary: (previewId, businessId, employeeIds) =>
      appendOutboxEvent(tx, ids.newId(), {
        aggregateType: 'import_preview',
        aggregateId: previewId,
        eventType: 'ImportCommitted',
        payload: {
          preview_id: previewId,
          business_id: businessId,
          entity: 'employees',
          created_count: employeeIds.length,
          employee_ids: [...employeeIds],
          committed_at: new Date().toISOString(),
        },
      }),
    markCommitted: (previewId) =>
      tx.execute(sql`UPDATE import_previews SET committed_at=clock_timestamp()
        WHERE company_id=${companyId} AND id=${previewId}`).then(() => undefined),
  };
}

async function savePreview(
  tx: Tx,
  companyId: string,
  userId: string,
  input: SaveImportPreviewInput,
): Promise<void> {
  await tx.execute(sql`INSERT INTO import_previews
    (company_id,id,business_id,entity,file_id,created_by,created_at,expires_at,row_count,error_count,rows,errors)
    VALUES (${companyId},${input.id},${input.businessId},${input.entity},${input.fileId},${userId},
      ${input.createdAt},${input.expiresAt},${input.rows.length},${input.errors.length},
      ${JSON.stringify(input.rows)}::jsonb,${JSON.stringify(input.errors)}::jsonb)`);
}

type PreviewRow = {
  id: string;
  business_id: string;
  committed_at: Date | string | null;
  expires_at: Date | string;
  rows: readonly EmployeeImportCandidate[];
  errors: readonly EmployeeImportRowError[];
};

// الداتابيز قد تعيد timestamptz كـ Date أو نص حسب الإعداد؛ نوحّده إلى ISO.
function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function loadPreview(
  tx: Tx,
  companyId: string,
  previewId: string,
): Promise<StoredImportPreview | null> {
  const [row] = await tx.execute<PreviewRow>(sql`SELECT id,business_id,committed_at,expires_at,rows,errors
    FROM import_previews WHERE company_id=${companyId} AND id=${previewId} FOR UPDATE`);
  if (row === undefined) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    committed_at: row.committed_at === null ? null : asIso(row.committed_at),
    expires_at: asIso(row.expires_at),
    rows: row.rows,
    errors: row.errors,
  };
}

async function insertEmployees(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  records: readonly EmployeeRecord[],
): Promise<void> {
  for (const record of records) {
    await tx.execute(sql`INSERT INTO employees (company_id,id,business_id,primary_branch_id,user_id,name_ar,name_en,role_code,hire_date,contract_end,created_at)
      VALUES (${companyId},${record.id},${record.business_id},${record.primary_branch_id},${record.user_id},${record.name_ar},${record.name_en},${record.role_code},${record.hire_date},${record.contract_end},${record.created_at})`);
    await tx.execute(sql`INSERT INTO employee_branches (company_id,id,business_id,employee_id,branch_id,"from")
      VALUES (${companyId},${ids.newId()},${record.business_id},${record.id},${record.primary_branch_id},${record.hire_date})`);
    await appendAuditLog(tx, ids.newId(), {
      entity: 'employee',
      entityId: record.id,
      action: 'imported',
      after: record,
    });
    await appendOutboxEvent(tx, ids.newId(), {
      aggregateType: 'employee',
      aggregateId: record.id,
      eventType: 'EmployeeImported',
      payload: {
        employee_id: record.id,
        business_id: record.business_id,
        primary_branch_id: record.primary_branch_id,
        name_en: record.name_en,
        name_ar: record.name_ar,
        role_code: record.role_code,
        hire_date: record.hire_date,
        contract_end: record.contract_end,
        created_at: record.created_at,
      },
    });
  }
}

function cleanImportError(error: unknown): never {
  if (
    error instanceof EmployeeImportError ||
    error instanceof IdempotencyKeyBusyError ||
    error instanceof IdempotencyKeyReusedError
  )
    throw error;
  const cause = error instanceof Error && 'cause' in error ? error.cause : error;
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    const code = String(cause.code);
    if (code === '23503') throw new EmployeeImportError('EMPLOYEE_BRANCH_NOT_FOUND');
    if (['40001', '40P01', '55P03'].includes(code))
      throw new EmployeeImportError('TRANSACTION_RETRY_REQUIRED');
  }
  throw new Error('EMPLOYEE_IMPORT_PERSISTENCE_FAILED', { cause: error });
}

export function createEmployeeImportTransactions(
  database: TenantWrappers,
  ids: IdGenerator,
): EmployeeImportTransactions {
  return {
    runPreview: async ({ companyId, userId }, work) => {
      try {
        return await database.withTenant(
          companyId,
          (tx) => work(previewScope(tx, companyId, userId)),
          { userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
    runCommit: async ({ companyId, userId, key, fingerprint }, work) => {
      try {
        return await database.withTenant(
          companyId,
          async (tx) => {
            const scope = commitScope(tx, companyId, userId, ids);
            const result = await runIdempotent(
              tx,
              { scope: 'COMPANY', operation: 'import-employees', key, fingerprint },
              async () => {
                const body = await work(scope);
                return { status: 201, body };
              },
            );
            return result.body as Awaited<ReturnType<typeof work>>;
          },
          { userId },
        );
      } catch (error) {
        cleanImportError(error);
      }
    },
  };
}
