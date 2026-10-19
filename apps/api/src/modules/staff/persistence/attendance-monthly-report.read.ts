import { attendanceMonthlyReport, type AttendanceMonthlyReportQuery, type AttendanceReportBranchInputs } from '@pospay/contracts';
import { attendanceMonthDates, computeAttendanceMonthlyReport } from '@pospay/domain';
import type { TenantWrappers, Tx } from '@pospay/db';
import type { AuditTrail } from '../../../shared/ports/audit-trail.port.ts';
import { ApiError } from '../../../shared/errors.ts';
import type { AttendanceReportRequest, AttendanceReportTransactions } from '../ports/attendance-report.port.ts';

type Scope = { businessId: string; branches: { id: string; timezone: string }[] };
type ReportAudit = (tx: Tx) => AuditTrail;
type ReportAccess = (tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, month: string) =>
  Promise<Scope | 'NOT_FOUND' | 'FEATURE_DISABLED'>;
type ReportInputs = (tx: Tx, companyId: string, scope: Scope, from: string, to: string) => Promise<readonly {
  employee_id: string; name_ar: string | null; name_en: string; employee_number: number;
  branches: AttendanceReportBranchInputs[];
}[]>;

export function createAttendanceReportTransactions(database: TenantWrappers, audit: ReportAudit,
  access: ReportAccess, inputs: ReportInputs): AttendanceReportTransactions {
  return { run: (request, work) => database.withTenant(request.companyId, async (tx) => {
    const scope = await access(tx, request.companyId, request.userId, request.businessId, request.branchId, request.month);
    if (typeof scope === 'string') throw new ApiError(scope);
    const report = await readReport(tx, request, scope, inputs);
    return work({ report, recordDownload: () => audit(tx).record({
      entity: 'attendance_monthly_report', entityId: scope.businessId, action: 'attendance.report.downloaded',
      after: { business_id: scope.businessId, branch_id: request.branchId, month: request.month },
    }) });
  }, { userId: request.userId }) };
}

async function readReport(tx: Tx, request: AttendanceReportRequest, scope: Scope, inputs: ReportInputs) {
  const dates = attendanceMonthDates(request.month);
  const from = dates[0]?.date, to = dates.at(-1)?.date;
  if (!from || !to) throw new ApiError('VALIDATION_FAILED');
  const rows = await inputs(tx, request.companyId, scope, from, to);
  return attendanceMonthlyReport.parse({ business_id: scope.businessId, branch_id: request.branchId, month: request.month,
    rows: rows.map((row) => ({ employee_id: row.employee_id, name_ar: row.name_ar, name_en: row.name_en,
      employee_number: row.employee_number, ...computeAttendanceMonthlyReport(row.branches, request.month) })) });
}

export function createAttendanceReportReader(transactions: AttendanceReportTransactions) {
  return (actor: { companyId: string; userId: string }, query: AttendanceMonthlyReportQuery,
    businessId: string, branchId: string) => transactions.run({ ...actor, businessId, branchId, month: query.month },
      async (context) => context.report);
}
