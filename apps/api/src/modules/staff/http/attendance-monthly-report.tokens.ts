import type { AttendanceMonthlyReport, AttendanceMonthlyReportQuery } from '@pospay/contracts';

export const ATTENDANCE_REPORT_READER = Symbol('ATTENDANCE_REPORT_READER');
export const ATTENDANCE_REPORT_EXPORT = Symbol('ATTENDANCE_REPORT_EXPORT');
export const ATTENDANCE_REPORT_COMPANY = Symbol('ATTENDANCE_REPORT_COMPANY');
export type AttendanceReportReader = (actor: { companyId: string; userId: string }, query: AttendanceMonthlyReportQuery,
  businessId: string, branchId: string) => Promise<AttendanceMonthlyReport>;
export type AttendanceReportCompany = (userId: string, companyId: string) => Promise<boolean>;
