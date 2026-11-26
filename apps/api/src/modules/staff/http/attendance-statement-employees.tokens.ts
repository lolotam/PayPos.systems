import type {
  AttendanceStatementEmployeeOptions,
  AttendanceStatementEmployeesQuery,
} from '@pospay/contracts';

/** رمز قارئ موظفات كشف الحضور؛ القارئ نفسه في `persistence/attendance-statement-employees.read.ts`. */
export const ATTENDANCE_STATEMENT_EMPLOYEES_READ = Symbol('ATTENDANCE_STATEMENT_EMPLOYEES_READ');

/** نطاق القراءة: الشركة والمستخدم من الجلسة، والنشاط والفرع من المسار. */
export interface AttendanceStatementEmployeesScope {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
}

/**
 * قارئ موظفات كشف الحضور: من نطاق المسار والفترة لقائمة الموظفات اللي ليها تغطية.
 *
 * @param scope الشركة والمستخدم والنشاط والفرع
 * @param period أول وآخر يوم في الفترة
 * @returns الموظفات مرتبة برقم الموظفة
 */
export type AttendanceStatementEmployeesRead = (
  scope: AttendanceStatementEmployeesScope,
  period: AttendanceStatementEmployeesQuery,
) => Promise<AttendanceStatementEmployeeOptions>;
