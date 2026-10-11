import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { ATTENDANCE_REPORT_READER, createAttendanceReportReader } from './http/attendance-monthly-report.read.ts';
import { attendanceReportScope } from './persistence/attendance-report-access.adapter.ts';
import { createAttendanceReportAudit } from './persistence/attendance-report-audit.adapter.ts';

export function attendanceReportProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  return [{ provide: ATTENDANCE_REPORT_READER, useValue: database === undefined ? null :
    createAttendanceReportReader(database, createAttendanceReportAudit(ids), attendanceReportScope) }];
}
