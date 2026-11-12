import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

import { TENANT, USER } from './tenancy-fixtures.ts';

export type LeaveReportTenant = { company: string; business: string; branch: string };

/**
 * يُدرج تقرير سجل إجازات معلقاً وصالحاً ويرجع معرّفه (UUID)؛
 * كل اختبار يحدد التجاوزات المطلوبة لاختبار القيد المعني دون تأثير على بقية الأعمدة.
 *
 * @param tx        معاملة قاعدة البيانات (كـ pospay_app أو owner)
 * @param overrides قيم مخصصة للأعمدة لتجاوز القيم الافتراضية
 * @param tenant    بيانات الشركة والنشاط والفرع المراد إدراج التقرير لها
 * @returns معرّف التقرير المُنشأ
 */
export async function insertLeaveReport(
  tx: postgres.TransactionSql,
  overrides: Record<string, unknown> = {},
  tenant: LeaveReportTenant = TENANT.A,
): Promise<string> {
  const asOf = new Date('2026-11-12T10:00:00.000Z');
  const deadlineAt = new Date('2026-11-12T10:05:00.000Z');
  const expiresAt = new Date('2026-11-12T11:00:00.000Z');
  const row = {
    company_id: tenant.company,
    id: randomUUID(),
    business_id: tenant.business,
    created_by: USER,
    query: tx.json({ from: '2026-01-01', to: '2026-12-31' }),
    fingerprint: '0'.repeat(64),
    scope: tx.json({ branches: [tenant.branch] }),
    as_of: asOf,
    deadline_at: deadlineAt,
    status: 'pending',
    error_code: null,
    row_count: 0,
    computed_at: null,
    expires_at: expiresAt,
    ...overrides,
  };
  await tx`INSERT INTO leave_history_reports ${tx(row)}`;
  return String(row.id);
}

/**
 * يُدرج صف نتيجة صالحاً لتقرير سجل إجازات محدد.
 *
 * @param tx        معاملة قاعدة البيانات
 * @param reportId  معرّف التقرير الأب
 * @param seq       الرقم التسلسلي للصف (يبدأ من 1)
 * @param overrides قيم مخصصة للأعمدة لتجاوز الافتراضي
 * @param tenant    بيانات الشركة التابع لها التقرير
 */
export async function insertLeaveReportRow(
  tx: postgres.TransactionSql,
  reportId: string,
  seq = 1,
  overrides: Record<string, unknown> = {},
  tenant: LeaveReportTenant = TENANT.A,
): Promise<void> {
  const row = {
    company_id: tenant.company,
    report_id: reportId,
    seq,
    employee_id: randomUUID(),
    record: tx.json({ date: '2026-06-01', status: 'APPROVED' }),
    ...overrides,
  };
  await tx`INSERT INTO leave_history_report_rows ${tx(row)}`;
}
