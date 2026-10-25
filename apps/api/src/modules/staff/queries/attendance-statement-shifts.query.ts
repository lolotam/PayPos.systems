import {
  attendanceStatementShiftOptions,
  type AttendanceStatementShiftOptions,
  type AttendanceStatementShiftPeriod,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { ApiError } from '../../../shared/errors.ts';

export const ATTENDANCE_STATEMENT_SHIFTS_QUERY = Symbol('ATTENDANCE_STATEMENT_SHIFTS_QUERY');

export type AttendanceStatementShiftsQuery = (
  scope: AttendanceStatementShiftScope & { userId: string },
  period: AttendanceStatementShiftPeriod,
) => Promise<AttendanceStatementShiftOptions>;

export function createAttendanceStatementShiftsQuery(
  database: Pick<TenantWrappers, 'withTenant'>,
  branchRead: (
    tx: Tx,
    companyId: string,
    businessId: string,
    branchId: string,
  ) => Promise<AttendanceStatementShiftBranch | null>,
): AttendanceStatementShiftsQuery {
  return (scope, period) =>
    database.withTenant(
      scope.companyId,
      async (tx) => {
        const branch = await branchRead(tx, scope.companyId, scope.businessId, scope.branchId);
        if (branch === null) throw new ApiError('ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND');
        return readAttendanceStatementShifts(tx, scope, branch, period);
      },
      { userId: scope.userId },
    );
}

interface ShiftPairRow extends Record<string, unknown> {
  pair_start: string;
  pair_end: string;
}

/** نطاق الشاشة: الشركة والنشاط والفرع من المسار. */
export interface AttendanceStatementShiftScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

/** الفرع بعد تأكيد تبعيته للنشاط، ومعاه منطقته الفعالة. */
export interface AttendanceStatementShiftBranch {
  id: string;
  timezone: string;
}

/**
 * جملة أزواج الشيفت في الفرع: بداية ونهاية كل وردية بالوقت المحلي للفرع.
 * التحويل من اللحظة بالوقت المحلي هو نفس حساب `attendanceShiftMatchesPair`، فالزوج اللي بيظهر
 * دايمًا هو اللي الفلتر بيقابله.
 */
export function attendanceStatementShiftPairsStatement(
  companyId: string,
  businessId: string,
  branchId: string,
  from: string,
  to: string,
  timezone: string,
) {
  // أسماء الأعمدة في الإسقاط مخالفة لأعمدة الجدول (`start` و`end` موجودين أصلاً)،
  // عشان ORDER BY يبقى على الزوج المطبوع مش على نص الجدول المحفوظ.
  return sql`SELECT DISTINCT to_char(sh.starts_at AT TIME ZONE ${timezone}, 'HH24:MI') AS "pair_start",
      to_char(sh.ends_at AT TIME ZONE ${timezone}, 'HH24:MI') AS "pair_end"
    FROM staff_schedules sc
    JOIN staff_schedule_shifts sh ON sh.company_id = sc.company_id AND sh.schedule_id = sc.id
    WHERE sc.company_id = ${companyId} AND sc.business_id = ${businessId} AND sc.branch_id = ${branchId}::uuid
      AND sc.week_start BETWEEN (${from}::date - 7) AND ${to}::date
      AND sh.working_date BETWEEN ${from}::date AND ${to}::date
    ORDER BY "pair_start", "pair_end"`;
}

/**
 * أزواج الشيفت المتاحة في فرع وفي فترة؛ بتخدم منتقي الشيفت في شاشة كشف الحضور (FR-001a).
 * مشغّل الاستعلام بيفتح معاملة واحدة وبيأكد الفرع قبل ما ينادي هنا.
 *
 * @param tx معاملة المستأجر اللي اتفتحت في مشغّل الاستعلام
 * @param scope الشركة والنشاط والفرع من المسار
 * @param branch الفرع بعد ما اتأكد إنه في النشاط
 * @param period أول وآخر يوم في الفترة
 * @returns أزواج البداية والنهاية المتاحة في الفترة
 */
export async function readAttendanceStatementShifts(
  tx: Tx,
  scope: AttendanceStatementShiftScope,
  branch: AttendanceStatementShiftBranch,
  period: AttendanceStatementShiftPeriod,
): Promise<AttendanceStatementShiftOptions> {
  const rows = await tx.execute<ShiftPairRow>(
    attendanceStatementShiftPairsStatement(
      scope.companyId,
      scope.businessId,
      scope.branchId,
      period.from,
      period.to,
      branch.timezone,
    ),
  );
  return attendanceStatementShiftOptions.parse({
    shifts: rows.map((row) => ({ start: row.pair_start, end: row.pair_end })),
  });
}
