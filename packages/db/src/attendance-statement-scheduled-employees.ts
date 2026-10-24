import { sql } from 'drizzle-orm';

/**
 * الفرع اللي بتتقرأ جداوله: الـ id والمنطقة المحلية بتاعته.
 */
export interface AttendanceStatementBranch {
  readonly id: string;
  readonly timezone: string;
}

/**
 * كشف الحضور الرسمي (27g) بيقرأ الموظفات اللي ليها جدول في الفرع والفترة بس؛
 * مرشح تقرير 27b بيضل زي ما هو، والدمج بيتم في packages/domain.
 *
 * @param companyId شركة المستأجر
 * @param businessId النشاط
 * @param branch الفرع والمنطقة المحلية بتاعته
 * @param from أول يوم عمل في الفترة
 * @param to آخر يوم عمل في الفترة
 * @returns الاستعلام اللي بيرجع صفوف الموظفات بنفس شكل تقرير 27b
 */
export function attendanceStatementScheduledEmployeesStatement(
  companyId: string,
  businessId: string,
  branch: AttendanceStatementBranch,
  from: string,
  to: string,
) {
  // شاشة كشف الحضور الرسمي تقرأ الموظفات المجدول بس في الفرع؛ يوم الـ context قبل البداية بيجيب معاهم.
  return sql`WITH shifts AS MATERIALIZED (
      SELECT sc.employee_id,json_agg(row_to_json(v) ORDER BY sh.starts_at) AS shifts
      FROM staff_schedules sc JOIN staff_schedule_shifts sh ON sh.company_id=sc.company_id AND sh.schedule_id=sc.id
        CROSS JOIN LATERAL (SELECT sh.working_date,sh.starts_at,sh.ends_at,sh.break_starts_at,sh.break_ends_at) v
      WHERE sc.company_id=${companyId} AND sc.business_id=${businessId} AND sc.branch_id=${branch.id}::uuid
        AND sc.week_start BETWEEN (${from}::date-7) AND ${to}::date
        AND sh.working_date BETWEEN (${from}::date-1) AND ${to}::date
      GROUP BY sc.employee_id
      HAVING bool_or(sh.working_date BETWEEN ${from}::date AND ${to}::date)),
    approved_employee_leave AS MATERIALIZED (
      SELECT l.employee_id,json_agg(row_to_json(v)) AS leave
      FROM leave_requests l
      CROSS JOIN LATERAL (SELECT l.id,l.type,l.kind,l."from",l."to",l.starts_at,l.ends_at) v
      WHERE l.company_id=${companyId} AND l.business_id=${businessId}
        AND l.status='APPROVED'
        AND l.employee_id IN (SELECT employee_id FROM shifts)
        AND l."from"<=${to}::date+1 AND l."to">=${from}::date GROUP BY l.employee_id)
    SELECT e.id AS employee_id,e.name_ar,e.name_en,e.employee_number,json_build_array(json_build_object(
      'timezone',${branch.timezone}::text,'sessions','[]'::json,'shifts',COALESCE(sh.shifts,'[]'::json),
      'contract',NULL,'leave_for_branch',COALESCE(l.leave,'[]'::json))) AS branches
    FROM shifts sh JOIN employees e ON e.company_id=${companyId} AND e.business_id=${businessId} AND e.id=sh.employee_id
    LEFT JOIN approved_employee_leave l ON l.employee_id=sh.employee_id
    ORDER BY e.id`;
}
