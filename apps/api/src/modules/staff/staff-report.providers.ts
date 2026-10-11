import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { ATTENDANCE_REPORT_COMPANY, ATTENDANCE_REPORT_EXPORT, ATTENDANCE_REPORT_READER } from './http/attendance-monthly-report.tokens.ts';
import { AttendanceReportCompanyGuard } from './http/attendance-report-company.guard.ts';
import { createAttendanceReportReader, createAttendanceReportTransactions } from './persistence/attendance-monthly-report.read.ts';
import { attendanceMonthlyInputs } from './queries/attendance-monthly-report.query.ts';
import { attendanceMonthlyCsv } from './http/attendance-monthly-report.csv.ts';
import { ExportAttendanceReportUseCase } from './use-cases/export-attendance-report/export-attendance-report.usecase.ts';
import { attendanceReportScope, createAttendanceReportCompanyAccess } from './persistence/attendance-report-access.adapter.ts';
import { createAttendanceReportAudit } from './persistence/attendance-report-audit.adapter.ts';

export function attendanceReportProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  const transactions = database === undefined ? null : createAttendanceReportTransactions(database,
    createAttendanceReportAudit(ids), attendanceReportScope, attendanceMonthlyInputs);
  return [AttendanceReportCompanyGuard,
    { provide: ATTENDANCE_REPORT_READER, useValue: transactions && createAttendanceReportReader(transactions) },
    { provide: ATTENDANCE_REPORT_EXPORT, useValue: transactions && new ExportAttendanceReportUseCase(transactions, { render: attendanceMonthlyCsv }) },
    { provide: ATTENDANCE_REPORT_COMPANY, useValue: database === undefined ? null : createAttendanceReportCompanyAccess(database) }];
}
