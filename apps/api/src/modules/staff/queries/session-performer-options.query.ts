import { sessionPerformerOptionPage, type SessionPerformerOptionsQuery } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

// نموذج التسجيل ولقطة الحفظ يستهلكان حقائق يوم الأداء نفسها دون اشتراط جلسة حضور مفتوحة الآن.
export function sessionPerformerWarningColumns(branchId: string, day: string, occurredAt: Date) {
  return sql`EXISTS(SELECT 1 FROM attendance_sessions a WHERE a.company_id=e.company_id AND a.employee_id=e.id
    AND a.branch_id=${branchId} AND a.working_date=${day}::date AND a.voided_at IS NULL
    AND a.status IN ('OPEN','CLOSED','MISSED_OUT')) AS clocked_in,
    EXISTS(SELECT 1 FROM leave_requests l WHERE l.company_id=e.company_id AND l.employee_id=e.id AND l.status='APPROVED'
      AND ((l.kind='FULL_DAY' AND l."from"<=${day}::date AND l."to">=${day}::date)
        OR (l.kind='PARTIAL' AND l.starts_at<=${occurredAt.toISOString()}::timestamptz
          AND l.ends_at>${occurredAt.toISOString()}::timestamptz))) AS approved_leave`;
}

// منتقي الموظفات يعرض الأهلية التاريخية والأسماء والتنبيهين فقط؛ فلاتر الأهلية تسبق حد الصفحة.
export function sessionPerformerOptionsStatement(companyId: string, businessId: string, branchId: string,
  day: string, query: SessionPerformerOptionsQuery) {
  return sql`SELECT e.id,e.name_ar,e.name_en,${sessionPerformerWarningColumns(branchId, day, new Date(query.occurred_at))}
    FROM employees e WHERE e.company_id=${companyId} AND e.business_id=${businessId}
      AND e.deleted_at IS NULL AND e.hire_date<=${day}::date AND (e.contract_end IS NULL OR e.contract_end>=${day}::date)
      AND EXISTS(SELECT 1 FROM employee_branches eb WHERE eb.company_id=e.company_id AND eb.business_id=e.business_id
        AND eb.employee_id=e.id AND eb.branch_id=${branchId} AND eb."from"<=${day}::date AND (eb."to" IS NULL OR eb."to">${day}::date))
      ${query.cursor === undefined ? sql`` : sql`AND e.id>${query.cursor}`}
      ${query.q === undefined ? sql`` : sql`AND (strpos(lower(e.name_ar),lower(${query.q}))>0 OR strpos(lower(e.name_en),lower(${query.q}))>0)`}
    ORDER BY e.id LIMIT ${query.limit + 1}`;
}
export async function sessionPerformerOptionsPage(tx: Tx, companyId: string, businessId: string, branchId: string,
  day: string, query: SessionPerformerOptionsQuery) {
  const rows = await tx.execute<{ id: string; name_ar: string | null; name_en: string; clocked_in: boolean; approved_leave: boolean }>(
    sessionPerformerOptionsStatement(companyId, businessId, branchId, day, query));
  const items = rows.slice(0, query.limit).map((r) => ({ id: r.id, name_ar: r.name_ar, name_en: r.name_en,
    not_clocked_in_warning: !r.clocked_in, approved_leave_warning: r.approved_leave }));
  return sessionPerformerOptionPage.parse({ items, next_cursor: rows.length > query.limit ? items.at(-1)?.id : null });
}
