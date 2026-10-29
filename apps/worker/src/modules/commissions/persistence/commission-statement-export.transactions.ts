import { parseMoney } from '@pospay/domain';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { SQL } from 'drizzle-orm';

import type {
  CommissionBranchName,
  CommissionBranchNamesReader,
} from '../ports/commission-branch-names.port.ts';
import type {
  CommissionStatementExportReader,
  CommissionStatementExportReaderData,
  CommissionStatementExportRequest,
  CommissionStatementExportScope,
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
  partial: boolean;
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

/**
 * نطاق التصدير المحفوظ: BUSINESS أو BRANCHES بس. أي قيمة تانية كسر في الثوابت
 * (CHECK في الداتابيز بيمنعها)، فبنقفل بدل ما نصدّر كشف شركة كاملة بالغلط.
 *
 * @param value النطاق المحفوظ في صف طلب التصدير
 * @returns النطاق بعد تحقق الثابت
 */
export function commissionStatementExportScope(value: string): CommissionStatementExportScope {
  if (value === 'BUSINESS') return 'BUSINESS';
  if (value === 'BRANCHES') return 'BRANCHES';
  throw new Error('commission_statement_exports.scope must be BUSINESS or BRANCHES');
}

function request(row: RequestRow): CommissionStatementExportRequest {
  return {
    statementId: row.statement_id,
    businessId: row.business_id,
    period: row.period,
    statementStatus: row.statement_status,
    language: row.language === 'en' ? 'en' : 'ar',
    scope: commissionStatementExportScope(row.scope),
    branchIds: row.branch_ids,
    employeeIds: row.employee_ids,
  };
}

function rows(records: FrozenRow[]): CommissionStatementExportReaderData['rows'] {
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
    sourceBranchNameAr: null,
    sourceBranchNameEn: null,
    attachedBranchIds: row.attached_branch_ids,
    partial: row.partial,
    businessDate: row.business_date,
    serviceNameAr: row.service_name_ar,
    serviceNameEn: row.service_name_en,
    customerName: row.customer_name,
  }));
}

/**
 * معرّفات الفروع المختلفة في صفوف الكشف، عشان نقرا الأسماء مرة واحدة بس.
 *
 * @param rows صفوف الكشف المجمّدة
 * @returns معرّفات الفروع من غير تكرار
 */
function branchIdsOf(rows: CommissionStatementExportReaderData['rows']): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.sourceBranchId !== null) ids.add(row.sourceBranchId);
  }
  return [...ids];
}

/**
 * يملأ اسم مكان التنفيذ من قراءة التينانسي؛ الفرع اللي مش موجود بيفضل من غير اسم
 * والصف ما بيضيعش، لأن معرّف الفرع مش شرط في الفلتر أصلاً.
 *
 * @param rows صفوف الكشف المجمّدة
 * @param names الأسماء المقروءة عن طريق البورت
 * @returns الصفوف نفسها وأسماء مكان التنفيذ مملوءة
 */
export function withBranchNames(
  rows: CommissionStatementExportReaderData['rows'],
  names: ReadonlyMap<string, CommissionBranchName>,
): CommissionStatementExportReaderData['rows'] {
  return rows.map((row) => {
    const name = row.sourceBranchId === null ? undefined : names.get(row.sourceBranchId);
    return {
      ...row,
      sourceBranchNameAr: name?.nameAr ?? null,
      sourceBranchNameEn: name?.nameEn ?? null,
    };
  });
}

/**
 * يقرأ أسماء الفروع مرة واحدة على معاملة المستدعي.
 *
 * @param reader بورت أسماء الفروع
 * @param tx معاملة المستأجر
 * @param companyId الشركة
 * @param businessId النشاط
 * @param rows صفوف الكشف المجمّدة
 * @returns خريطة من معرّف الفرع إلى اسمه
 */
export async function readBranchNames(
  reader: CommissionBranchNamesReader,
  tx: Tx,
  companyId: string,
  businessId: string,
  rows: CommissionStatementExportReaderData['rows'],
): Promise<ReadonlyMap<string, CommissionBranchName>> {
  return reader.names(tx, companyId, businessId, branchIdsOf(rows));
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

/** قارئ التصدير: معاملة قراءة واحدة للطلب وصفوفه المجمّدة وأسماء فروعها، ثم تُقفل قبل بناء الملف. */
export function commissionStatementExportTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  statements: CommissionStatementExportStatements,
  branchNames: CommissionBranchNamesReader,
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
        const frozen = rows(records);
        const names = await readBranchNames(
          branchNames,
          tx,
          companyId,
          exportRequest.businessId,
          frozen,
        );
        signal?.throwIfAborted();
        return { request: exportRequest, rows: withBranchNames(frozen, names), paidCash: null };
      });
    },
  };
}
