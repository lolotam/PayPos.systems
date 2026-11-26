import { sql } from 'drizzle-orm';

import { attendanceReportContractsStatement } from './attendance-report-contracts.ts';
import type { AttendanceStatementBranch } from './attendance-statement-scheduled-employees.ts';

/**
 * قائمة اختيار الموظفات في كشف الحضور (FR-001b) بتقرأ مرشحي الفرع والفترة بحمولة خفيفة:
 * جلسة محتسبة واحدة ووردية واحدة لكل موظفة بدل تجميع كل جلسات وورديات الفترة (حد 366 يوم).
 * قاعدة التغطية نفسها (`hasAttendanceStatementCoverage`) بتحكم في packages/domain، والوجود يكفي
 * لها: «جلسة محتسبة في الفترة» و«وردية في الفترة خلصت» شرطان بيتحققوا بأول جلسة وأقدم نهاية وردية.
 * شرط «الجلسة المحتسبة» هنا بيطابق `isCountedAttendanceSession`؛ اختبار التكافؤ بيمسك أي انحراف.
 *
 * @param companyId شركة المستأجر
 * @param businessId النشاط
 * @param branch الفرع والمنطقة المحلية بتاعته
 * @param from أول يوم عمل في الفترة
 * @param to آخر يوم عمل في الفترة
 * @returns الاستعلام اللي بيرجع صف موظفة بفرع واحد بنفس شكل تقرير 27b
 */
export function attendanceStatementEmployeeCoverageStatement(
  companyId: string,
  businessId: string,
  branch: AttendanceStatementBranch,
  from: string,
  to: string,
) {
  const branchIds = sql`ARRAY[${branch.id}::uuid]::uuid[]`;
  const zones = sql`(${branch.id}::uuid,${branch.timezone}::text)`;
  const contracts = attendanceReportContractsStatement(companyId, businessId, branchIds, zones, from, to);
  // جلسة وردية واحدة بس لكل موظفة (LATERAL ... LIMIT 1): الفهرس بيقف عند أول تطابق بدل ما نرتب ٣٦٦ يوم لكل موظفة.
  return sql`WITH contracts AS MATERIALIZED (${contracts}),
    contract_days AS (
      SELECT c.employee_id FROM contracts c WHERE EXISTS (
        SELECT 1 FROM generate_series(${from}::date,${to}::date,interval '1 day') day
          CROSS JOIN jsonb_array_elements(c.entries) entry
        WHERE day::date>=c.hire_date::date AND (c.contract_end IS NULL OR day::date<=c.contract_end::date)
          AND (extract(dow FROM day)::int+1)%7=(entry->>'day')::int
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.links) link WHERE day::date>=(link->>'from')::date
            AND (link->>'to' IS NULL OR day::date<(link->>'to')::date)))),
    candidates AS MATERIALIZED (
      SELECT e.id AS employee_id,e.name_ar,e.name_en,e.employee_number,co.session,fs.shift
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT row_to_json(v) AS session
        FROM attendance_sessions s CROSS JOIN LATERAL (SELECT s.id AS session_id,s.working_date,s.clock_in,s.clock_out,s.status,
          s.source,s.late_minutes,s.scheduled_end,false AS voided,
          s.status='MISSED_OUT' AND EXISTS(SELECT 1 FROM attendance_corrections ac
            WHERE ac.company_id=s.company_id AND ac.session_id=s.id AND ac.field='CLOCK_OUT') AS clock_out_corrected) v
        WHERE s.company_id=${companyId} AND s.business_id=${businessId} AND s.employee_id=e.id AND s.branch_id=${branch.id}::uuid
          AND s.working_date BETWEEN ${from}::date AND ${to}::date AND s.voided_at IS NULL AND s.clock_out IS NOT NULL
          AND (s.status='CLOSED' OR (s.status='MISSED_OUT' AND v.clock_out_corrected))
        LIMIT 1) co ON true
      LEFT JOIN LATERAL (
        SELECT row_to_json(v) AS shift
        FROM staff_schedules sc JOIN staff_schedule_shifts sh ON sh.company_id=sc.company_id AND sh.schedule_id=sc.id
          CROSS JOIN LATERAL (SELECT sh.working_date,sh.starts_at,sh.ends_at,sh.break_starts_at,sh.break_ends_at) v
        WHERE sc.company_id=${companyId} AND sc.business_id=${businessId} AND sc.employee_id=e.id AND sc.branch_id=${branch.id}::uuid
          AND sc.week_start BETWEEN (${from}::date-7) AND ${to}::date
          AND sh.working_date BETWEEN ${from}::date AND ${to}::date
        ORDER BY sh.ends_at LIMIT 1) fs ON true
      WHERE e.company_id=${companyId} AND e.business_id=${businessId}
        AND (co.session IS NOT NULL OR fs.shift IS NOT NULL OR e.id IN (SELECT employee_id FROM contract_days))),
    approved_employee_leave AS MATERIALIZED (
      SELECT l.employee_id,json_agg(row_to_json(v)) AS leave
      FROM leave_requests l
      CROSS JOIN LATERAL (SELECT l.id,l.type,l.kind,l."from",l."to",l.starts_at,l.ends_at) v
      WHERE l.company_id=${companyId} AND l.business_id=${businessId} AND l.status='APPROVED'
        AND l.employee_id IN (SELECT employee_id FROM candidates)
        AND l."from"<=${to}::date+1 AND l."to">=${from}::date GROUP BY l.employee_id)
    SELECT ca.employee_id,ca.name_ar,ca.name_en,ca.employee_number,json_build_array(json_build_object(
      'timezone',${branch.timezone}::text,
      'sessions',CASE WHEN ca.session IS NULL THEN '[]'::json ELSE json_build_array(ca.session) END,
      'shifts',CASE WHEN ca.shift IS NULL THEN '[]'::json ELSE json_build_array(ca.shift) END,
      'contract',CASE WHEN c.employee_id IS NULL THEN NULL ELSE json_build_object(
        'hire_date',c.hire_date,'contract_end',c.contract_end,'entries',c.entries,'links',c.links) END,
      'leave_for_branch',COALESCE(l.leave,'[]'::json))) AS branches
    FROM candidates ca
    LEFT JOIN contracts c ON c.employee_id=ca.employee_id
    LEFT JOIN approved_employee_leave l ON l.employee_id=ca.employee_id
    ORDER BY ca.employee_number,ca.employee_id`;
}
