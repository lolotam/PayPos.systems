import { attendanceBoard as view, type AttendanceBoard } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { attendanceActorNameStatement } from './attendance-actor-name.query.ts';

export interface AttendanceBoardScope {
  companyId: string;
  businessId: string;
  branchId: string;
  timezone: string;
}
type BoardRows = Pick<AttendanceBoard, 'date' | 'in_now' | 'sessions'>;
const instant = (column: string) =>
  sql`to_char(${sql.raw(column)} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// لوحة الحضور تُسقط حقول الجلسة مباشرة؛ الاسم لا يعتمد على ارتباط الموظفة الحالي بالفرع.
const employeeProjection = sql`'employee_id',e.id,'name_ar',e.name_ar,'name_en',e.name_en`;

// لوحة الحضور تجمع التحذيرات المفتوحة وأسماء طرفي الطلب اليدوي من سجلات الشركة فقط.
const sessionProjection = sql`jsonb_build_object('id',s.id,${employeeProjection},
  'clock_in',${instant('s.clock_in')},'clock_out',${instant('s.clock_out')},'status',s.status,'source',s.source,
  'late_minutes',s.late_minutes,'scheduled_start',${instant('s.scheduled_start')},'scheduled_end',${instant('s.scheduled_end')},
  'geo',s.geo,'out_geo',s.out_geo,'revision',s.revision,
  'corrected',EXISTS(SELECT 1 FROM attendance_corrections c WHERE c.company_id=s.company_id AND c.session_id=s.id),
  'open_exceptions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind) ORDER BY x.id)
    FROM attendance_exceptions x WHERE x.company_id=s.company_id AND x.session_id=s.id AND x.status='OPEN'),'[]'::jsonb),
  'manual',CASE WHEN s.source='MANUAL' THEN (SELECT jsonb_build_object(
    'change_request_id',r.id,'requested_by',r.requested_by,
    'requested_by_name',${attendanceActorNameStatement(sql`s.company_id`, sql`r.requested_by`)},
    'approved_by',r.decided_by,
    'approved_by_name',${attendanceActorNameStatement(sql`s.company_id`, sql`r.decided_by`)})
    FROM attendance_change_requests r
    WHERE r.company_id=s.company_id AND r.id=s.change_request_id AND r.session_id=s.id
      AND r.kind='ADD_SESSION' AND r.status='APPROVED') ELSE NULL END)`;

// لوحة الحضور تعرض الجلسات المفتوحة من كل الأيام، وقائمة اليوم بحسب تاريخ الدخول المحلي المثبت.
export function attendanceBoardStatement(
  scope: AttendanceBoardScope,
  now: Date,
  requestedDate?: string,
) {
  const filter = sql`s.company_id=${scope.companyId} AND s.business_id=${scope.businessId}
    AND s.branch_id=${scope.branchId} AND s.voided_at IS NULL`;
  // تاريخ اللوحة يتبع الساعة المحقونة وتوقيت الفرع داخل نفس الاستعلام، حتى لو كانت القوائم فارغة.
  return sql`WITH local_date AS (
    SELECT (${now.toISOString()}::timestamptz AT TIME ZONE ${scope.timezone})::date AS today
  ), board_date AS (
    SELECT COALESCE(${requestedDate ?? null}::date,today) AS date,today FROM local_date
  ) SELECT to_char(b.date,'YYYY-MM-DD') AS date,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(${employeeProjection},'clock_in',${instant('s.clock_in')},
      'source',s.source,'scheduled_end',${instant('s.scheduled_end')}) ORDER BY s.clock_in,s.id)
      FROM attendance_sessions s JOIN employees e ON e.company_id=s.company_id AND e.business_id=s.business_id AND e.id=s.employee_id
      WHERE ${filter} AND b.date<=b.today AND s.status='OPEN'),'[]'::jsonb) AS in_now,
    COALESCE((SELECT jsonb_agg(${sessionProjection} ORDER BY s.clock_in,s.id)
      FROM attendance_sessions s JOIN employees e ON e.company_id=s.company_id AND e.business_id=s.business_id AND e.id=s.employee_id
      WHERE ${filter} AND b.date<=b.today AND s.working_date=b.date),'[]'::jsonb) AS sessions
    FROM board_date b`;
}

export async function attendanceBoard(
  tx: Tx,
  scope: AttendanceBoardScope,
  now: Date,
  requestedDate?: string,
): Promise<AttendanceBoard> {
  const [rows] = await tx.execute<BoardRows>(attendanceBoardStatement(scope, now, requestedDate));
  if (!rows) throw new Error('ATTENDANCE_BOARD_QUERY_FAILED');
  return view.parse({
    branch_id: scope.branchId,
    timezone: scope.timezone,
    generated_at: now.toISOString(),
    ...rows,
  });
}
