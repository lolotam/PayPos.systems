import { attendanceMonthlyReport, type AttendanceMonthlyReportQuery } from '@pospay/contracts';
import { attendanceMonthDates, computeAttendanceMonthlyReport } from '@pospay/domain';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import { ApiError } from '../../../shared/errors.ts';
import { attendanceMonthlyInputs, type AttendanceReportScope } from '../queries/attendance-monthly-report.query.ts';
import { attendanceMonthlyCsv } from './attendance-monthly-report.csv.ts';

export const ATTENDANCE_REPORT_READER = Symbol('ATTENDANCE_REPORT_READER');
export type ReportAudit = (tx: Tx) => AuditTrail;
export type ReportAccess = (tx: Tx, companyId: string, userId: string, businessId: string, branchId: string) =>
  Promise<AttendanceReportScope | 'NOT_FOUND' | 'FEATURE_DISABLED'>;

export function createAttendanceReportReader(database: TenantWrappers, audit: ReportAudit, access: ReportAccess) {
  return async (actor: { companyId: string; userId: string }, query: AttendanceMonthlyReportQuery,
    businessId: string, branchId: string, csv = false) => {
    const dates = attendanceMonthDates(query.month);
    const from = dates[0]?.date, to = dates.at(-1)?.date;
    if (!from || !to) throw new ApiError('VALIDATION_FAILED');
    return database.withTenant(actor.companyId, async (tx) => {
      const scope = await access(tx, actor.companyId, actor.userId, businessId, branchId);
      if (typeof scope === 'string') throw new ApiError(scope);
      const inputs = await attendanceMonthlyInputs(tx, actor.companyId, scope, from, to);
      const report = attendanceMonthlyReport.parse({ business_id: scope.businessId,
        branch_id: branchId, month: query.month,
        rows: inputs.map((row) => ({ employee_id: row.employee_id, name_ar: row.name_ar, name_en: row.name_en,
          ...computeAttendanceMonthlyReport(row.branches, query.month) })) });
      if (!csv) return report;
      const content = attendanceMonthlyCsv(report);
      await audit(tx).record({ entity: 'attendance_monthly_report', entityId: scope.businessId,
        action: 'attendance.report.downloaded', after: { business_id: scope.businessId,
          branch_id: branchId, month: query.month } });
      return content;
    }, { userId: actor.userId });
  };
}
export type AttendanceReportReader = ReturnType<typeof createAttendanceReportReader>;
