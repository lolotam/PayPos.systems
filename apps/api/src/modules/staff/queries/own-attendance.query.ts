import { ownAttendance, ownAttendanceQuery, type OwnAttendance } from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';
export const OWN_ATTENDANCE_READS = Symbol('OWN_ATTENDANCE_READS');
export interface OwnAttendanceContext {
  companyId: string;
  businessId: string;
  userId: string;
  branchId?: string;
}
export interface AttendanceBranchName {
  id: string;
  name_ar: string | null;
  name_en: string;
}
export interface OwnAttendanceReads {
  /** يطبق سياسة الفترة دون استيراد domain في مسار القراءة. */
  periodAllowed(month: string, currentMonth: string, monthsBack: number): boolean;
  /** يثبت الموظف والسلطة الحية بنفس لحظة القراءة قبل تشخيص الفترة. */
  context(
    tx: Tx,
    context: OwnAttendanceContext,
    now: Date,
  ): Promise<{
    employeeId: string;
    currentMonth: string;
    branches: readonly AttendanceBranchName[];
  } | null>;
  /** يقرأ نافذة الشهور من إعداد النشاط؛ القيمة القديمة تنكمش عبر القارئ الموجود. */
  monthsBack(tx: Tx, companyId: string, businessId: string): Promise<number>;
}

// شاشة «حضوري»: إسقاط صريح يمنع تسريب أسباب التصحيح وهوية المحرر والأوقات السابقة.
export function ownAttendanceStatement(
  c: OwnAttendanceContext,
  employeeId: string,
  month: string,
  branches: readonly AttendanceBranchName[],
) {
  return sql`SELECT s.id,s.working_date::text,
    b.name_ar AS branch_name_ar,b.name_en AS branch_name_en,
    to_char(s.clock_in AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_in,
    to_char(s.clock_out AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_out,
    s.late_minutes,s.source,s.status,
    COALESCE((SELECT jsonb_agg(DISTINCT x.kind ORDER BY x.kind) FROM attendance_exceptions x
      WHERE x.company_id=s.company_id AND x.session_id=s.id AND x.status='OPEN'),'[]'::jsonb) AS open_exceptions,
    EXISTS(SELECT 1 FROM attendance_corrections ac WHERE ac.company_id=s.company_id AND ac.session_id=s.id) AS corrected
    FROM attendance_sessions s JOIN jsonb_to_recordset(${JSON.stringify(branches)}::jsonb) AS b(id uuid,name_ar text,name_en text) ON b.id=s.branch_id
    WHERE s.company_id=${c.companyId} AND s.business_id=${c.businessId} AND s.employee_id=${employeeId}
      AND s.working_date>=${month + '-01'}::date
      AND s.working_date<(${month + '-01'}::date + interval '1 month')
      AND s.voided_at IS NULL ORDER BY s.working_date,s.clock_in,s.id`;
}
export async function readOwnAttendance(
  tx: Tx,
  context: OwnAttendanceContext,
  rawQuery: unknown,
  now: Date,
  reads: OwnAttendanceReads,
): Promise<OwnAttendance> {
  const live = await reads.context(tx, context, now);
  if (!live) throw new ApiError('FORBIDDEN');
  if (
    rawQuery !== null &&
    typeof rawQuery === 'object' &&
    ['employee_id', 'branch_id', 'business_id', 'company_id'].some((key) =>
      Object.hasOwn(rawQuery, key),
    )
  )
    throw new ApiError('FORBIDDEN');
  const parsed = ownAttendanceQuery.safeParse(rawQuery);
  if (!parsed.success) throw new ApiError('VALIDATION_FAILED');
  const month = parsed.data.month ?? live.currentMonth;
  const monthsBack = await reads.monthsBack(tx, context.companyId, context.businessId);
  if (!reads.periodAllowed(month, live.currentMonth, monthsBack))
    throw new ApiError('MY_PERIOD_OUT_OF_RANGE');
  const sessions = await tx.execute<OwnAttendance['sessions'][number]>(
    ownAttendanceStatement(context, live.employeeId, month, live.branches),
  );
  return ownAttendance.parse({ month, sessions: [...sessions] });
}
