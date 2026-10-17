import type { AttendanceReportBranchInputs } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { attendanceReportContractsStatement } from './attendance-report-contracts.query.ts';

export interface AttendanceReportScope {
  businessId: string;
  branches: { id: string; timezone: string }[];
}
export interface AttendanceReportInputRow extends Record<string, unknown> {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
  employee_number: number | null;
  branches: AttendanceReportBranchInputs[];
}

// يوم السياق على طرفي الشهر يحفظ تجاور بريك الوردية الليلية؛ المرشحون والحساب النهائي يلتزمان بالشهر المطلوب.
export function attendanceMonthlyInputsStatement(companyId: string, scope: AttendanceReportScope, from: string, to: string) {
  const branchIds = sql`ARRAY[${sql.join(scope.branches.map((branch) => sql`${branch.id}::uuid`), sql`, `)}]::uuid[]`;
  const zones = sql.join(scope.branches.map((branch) => sql`(${branch.id}::uuid,${branch.timezone}::text)`), sql`, `);
  const contracts = attendanceReportContractsStatement(companyId, scope.businessId, branchIds, zones, from, to);
  return sql`WITH contracts AS MATERIALIZED (${contracts}),
    zones(branch_id,timezone) AS (VALUES ${zones}),
    sessions AS MATERIALIZED (
      SELECT s.employee_id,s.branch_id,json_agg(row_to_json(v) ORDER BY s.clock_in,s.id) AS sessions,
        bool_or(s.working_date BETWEEN ${from}::date AND ${to}::date) AS in_month
      FROM attendance_sessions s CROSS JOIN LATERAL (SELECT s.working_date,s.clock_in,s.clock_out,s.status,
        s.source,s.late_minutes,s.scheduled_end,false AS voided,
        s.status='MISSED_OUT' AND EXISTS(SELECT 1 FROM attendance_corrections ac
          WHERE ac.company_id=s.company_id AND ac.session_id=s.id AND ac.field='CLOCK_OUT') AS clock_out_corrected) v
      WHERE s.company_id=${companyId} AND s.business_id=${scope.businessId}
        AND s.branch_id=ANY(${branchIds}) AND s.working_date BETWEEN (${from}::date-1) AND (${to}::date+1)
        AND s.voided_at IS NULL AND s.status<>'OPEN' GROUP BY s.employee_id,s.branch_id),
    shifts AS MATERIALIZED (
      SELECT sc.employee_id,sc.branch_id,json_agg(row_to_json(v) ORDER BY sh.starts_at) AS shifts
      FROM staff_schedules sc JOIN staff_schedule_shifts sh ON sh.company_id=sc.company_id AND sh.schedule_id=sc.id
        CROSS JOIN LATERAL (SELECT sh.working_date,sh.starts_at,sh.ends_at,sh.break_starts_at,sh.break_ends_at) v
      WHERE sc.company_id=${companyId} AND sc.business_id=${scope.businessId} AND sc.branch_id=ANY(${branchIds})
        AND sc.week_start BETWEEN (${from}::date-7) AND ${to}::date
        AND sh.working_date BETWEEN (${from}::date-1) AND ${to}::date GROUP BY sc.employee_id,sc.branch_id),
    approved_employee_leave AS MATERIALIZED (
      SELECT l.employee_id,json_agg(row_to_json(v)) AS leave
      FROM leave_requests l
      CROSS JOIN LATERAL (SELECT l.id,l.type,l.kind,l."from",l."to",l.starts_at,l.ends_at) v
      WHERE l.company_id=${companyId} AND l.business_id=${scope.businessId}
        AND l.status='APPROVED'
        AND l."from"<=${to}::date+1 AND l."to">=${from}::date GROUP BY l.employee_id),
    candidates AS (SELECT employee_id,branch_id FROM sessions WHERE in_month UNION
      SELECT c.employee_id,c.branch_id FROM contracts c WHERE EXISTS (
        SELECT 1 FROM generate_series(${from}::date,${to}::date,interval '1 day') day
          CROSS JOIN jsonb_array_elements(c.entries) entry
        WHERE day::date>=c.hire_date::date AND (c.contract_end IS NULL OR day::date<=c.contract_end::date)
          AND (extract(dow FROM day)::int+1)%7=(entry->>'day')::int
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.links) link WHERE day::date>=(link->>'from')::date
            AND (link->>'to' IS NULL OR day::date<(link->>'to')::date))))
    SELECT e.id AS employee_id,e.name_ar,e.name_en,e.employee_number,json_agg(json_build_object(
      'timezone',z.timezone,'sessions',COALESCE(s.sessions,'[]'::json),'shifts',COALESCE(sh.shifts,'[]'::json),
      'contract',CASE WHEN c.employee_id IS NULL THEN NULL ELSE json_build_object(
        'hire_date',c.hire_date,'contract_end',c.contract_end,'entries',c.entries,'links',c.links) END,
      'leave_for_branch',COALESCE(l.leave,'[]'::json)) ORDER BY ca.branch_id) AS branches
    FROM candidates ca JOIN employees e ON e.company_id=${companyId} AND e.business_id=${scope.businessId} AND e.id=ca.employee_id
    JOIN zones z ON z.branch_id=ca.branch_id
    LEFT JOIN contracts c ON c.employee_id=ca.employee_id AND c.branch_id=ca.branch_id
    LEFT JOIN sessions s ON s.employee_id=ca.employee_id AND s.branch_id=ca.branch_id
    LEFT JOIN shifts sh ON sh.employee_id=ca.employee_id AND sh.branch_id=ca.branch_id
    LEFT JOIN approved_employee_leave l ON l.employee_id=ca.employee_id
    GROUP BY e.id,e.name_ar,e.name_en,e.employee_number ORDER BY e.id`;
}

export function attendanceMonthlyInputs(tx: Tx, companyId: string, scope: AttendanceReportScope, from: string, to: string) {
  return tx.execute<AttendanceReportInputRow>(attendanceMonthlyInputsStatement(companyId, scope, from, to));
}
