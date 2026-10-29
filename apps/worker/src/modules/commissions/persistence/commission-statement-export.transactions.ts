import { parseMoney } from '@pospay/domain';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';

import type {
  CommissionStatementExportData,
  CommissionStatementExportReader,
  CommissionStatementExportRequest,
  CommissionStatementFrozenKind,
} from '../ports/commission-statement-export.port.ts';

const READ_TIMEOUT_MS = 20_000;

type RequestRow = {
  statement_id: string;
  business_id: string;
  period: string;
  language: string;
  scope: string;
  branch_ids: string[] | null;
  employee_ids: string[] | null;
  statement_status: 'APPROVED' | 'PAID';
};

type FrozenRow = {
  employee_id: string;
  employee_number: number;
  employee_name_ar: string | null;
  employee_name_en: string;
  source_ref: string;
  kind: CommissionStatementFrozenKind;
  amount: string;
  previous_amount: string | null;
  new_amount: string | null;
  source_period: string | null;
  source_branch_id: string | null;
  attached_branch_ids: string[];
  business_date: string | null;
  service_name_ar: string | null;
  service_name_en: string | null;
  customer_name: string | null;
};

export interface CommissionStatementRowsFilter {
  readonly companyId: string;
  readonly businessId: string;
  readonly statementId: string;
  readonly scope: 'BUSINESS' | 'BRANCHES';
  readonly branchIds: readonly string[] | null;
  readonly employeeIds: readonly string[] | null;
}

export interface CommissionStatementExportStatements {
  readonly request: (companyId: string, renderId: string) => SQL;
  readonly rows: (filter: CommissionStatementRowsFilter) => SQL;
}

function request(row: RequestRow): CommissionStatementExportRequest {
  return {
    statementId: row.statement_id,
    businessId: row.business_id,
    period: row.period,
    statementStatus: row.statement_status,
    language: row.language === 'en' ? 'en' : 'ar',
    scope: row.scope === 'BRANCHES' ? 'BRANCHES' : 'BUSINESS',
    branchIds: row.branch_ids,
    employeeIds: row.employee_ids,
  };
}

function rows(records: FrozenRow[]): CommissionStatementExportData['rows'] {
  return records.map((row) => ({
    employeeId: row.employee_id,
    employeeNumber: row.employee_number,
    employeeNameAr: row.employee_name_ar,
    employeeNameEn: row.employee_name_en,
    sourceRef: row.source_ref,
    kind: row.kind,
    amount: parseMoney(row.amount),
    previousAmount: row.previous_amount === null ? null : parseMoney(row.previous_amount),
    newAmount: row.new_amount === null ? null : parseMoney(row.new_amount),
    sourcePeriod: row.source_period,
    sourceBranchId: row.source_branch_id,
    attachedBranchIds: row.attached_branch_ids,
    businessDate: row.business_date,
    serviceNameAr: row.service_name_ar,
    serviceNameEn: row.service_name_en,
    customerName: row.customer_name,
  }));
}

async function readRequest(
  tx: Tx,
  statements: CommissionStatementExportStatements,
  companyId: string,
  renderId: string,
) {
  const records = await tx.execute<RequestRow>(statements.request(companyId, renderId));
  const row = records[0];
  return row === undefined ? null : request(row);
}

/** قارئ التصدير: معاملة قراءة واحدة للطلب وصفوفه المجمّدة، ثم تُقفل قبل بناء الملف. */
export function commissionStatementExportTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  statements: CommissionStatementExportStatements,
): CommissionStatementExportReader {
  return {
    read: (companyId, renderId, signal) => {
      signal?.throwIfAborted();
      return database.withTenant(companyId, async (tx) => {
        await tx.execute(`SET LOCAL statement_timeout = '${READ_TIMEOUT_MS}ms'`);
        signal?.throwIfAborted();
        const exportRequest = await readRequest(tx, statements, companyId, renderId);
        if (exportRequest === null) return null;
        signal?.throwIfAborted();
        const records = await tx.execute<FrozenRow>(
          statements.rows({ companyId, ...exportRequest }),
        );
        signal?.throwIfAborted();
        return { request: exportRequest, rows: rows(records), paidCash: null };
      });
    },
  };
}
