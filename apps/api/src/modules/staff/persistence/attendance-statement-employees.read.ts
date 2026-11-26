import {
  attendanceStatementEmployeeOptions,
  type AttendanceStatementEmployeeOptions,
} from '@pospay/contracts';
import {
  attendanceStatementEmployeeCoverageStatement,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { hasAttendanceStatementCoverage, type ReportBranchInputs } from '@pospay/domain';

import { ApiError } from '../../../shared/errors.ts';
import type { Clock } from '../../../shared/ports/clock.port.ts';
import { statementPeriodIsValid } from '../domain/attendance-statement-request.ts';
import { readStatementBranch } from './attendance-statement-branch.ts';

interface StatementEmployeeRow extends Record<string, unknown> {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
  employee_number: number;
  branches: ReportBranchInputs[];
}

/**
 * قارئ موظفات كشف الحضور: الموظفات اللي ليها تغطية في الفرع والفترة (FR-013a).
 * القراءة خفيفة (جلسة ووردية واحدة لكل مرشحة) عشان فترة الـ366 يوم تفضل تحت 200ms،
 * وقاعدة التغطية نفسها `hasAttendanceStatementCoverage` اللي بيستخدمها الرندر (ADR-0056 §2).
 *
 * @param database الـ wrappers بتاعة المستأجر
 * @param clock الساعة المحقونة؛ بتحدد سقف الشهر بالوقت المحلي للفرع
 * @returns قارئ الموظفات بالنطاق والفترة
 */
export function createAttendanceStatementEmployeesReader(
  database: Pick<TenantWrappers, 'withTenant'>,
  clock: Clock,
) {
  return async (
    scope: { companyId: string; userId: string; businessId: string; branchId: string },
    period: { from: string; to: string },
  ): Promise<AttendanceStatementEmployeeOptions> =>
    database.withTenant(
      scope.companyId,
      async (tx) => {
        const branch = await readStatementBranch(
          tx,
          scope.companyId,
          scope.businessId,
          scope.branchId,
        );
        if (branch === null) throw new ApiError('ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND');
        const now = clock.now();
        if (!statementPeriodIsValid(period.from, period.to, now, branch.timezone)) {
          throw new ApiError('ATTENDANCE_STATEMENT_PERIOD_INVALID');
        }
        return readAttendanceStatementEmployees(tx, scope, branch, period, now.toISOString());
      },
      { userId: scope.userId, readOnly: true },
    );
}

/**
 * يجمع موظفات الفرع في الفترة بمرشحي الجلسات والعقد والجدول، ويفلترهم بقاعدة التغطية نفسها اللي بيستخدمها الرندر.
 *
 * @param tx معاملة المستأجر المفتوحة
 * @param scope الشركة والنشاط من المسار
 * @param branch الفرع بعد ما اتأكد إنه في النشاط
 * @param period أول وآخر يوم في الفترة
 * @param cutoff لحظة الطلب؛ حدّ القطع لكل تغطية
 * @returns الموظفات مرتبة برقم الموظفة
 */
async function readAttendanceStatementEmployees(
  tx: Tx,
  scope: { companyId: string; businessId: string },
  branch: { id: string; timezone: string },
  period: { from: string; to: string },
  cutoff: string,
): Promise<AttendanceStatementEmployeeOptions> {
  const rows = await tx.execute<StatementEmployeeRow>(
    attendanceStatementEmployeeCoverageStatement(
      scope.companyId,
      scope.businessId,
      branch,
      period.from,
      period.to,
    ),
  );
  const employees = rows
    .filter((row) =>
      row.branches.some((entry) => hasAttendanceStatementCoverage(entry, period, cutoff, null)),
    )
    .map((row) => ({
      employee_id: row.employee_id,
      name_ar: row.name_ar,
      name_en: row.name_en,
      employee_number: row.employee_number,
    }));
  return attendanceStatementEmployeeOptions.parse({ employees });
}
