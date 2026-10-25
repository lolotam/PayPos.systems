import {
  attendanceMonthlyInputsStatement,
  attendanceStatementScheduledEmployeesStatement,
  type Tx,
} from '@pospay/db';
import { mergeAttendanceStatementRows, type ReportBranchInputs } from '@pospay/domain';

import type { StatementPeriod } from '../ports/attendance-statement.port.ts';

interface StatementInputRow extends Record<string, unknown> {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
  employee_number: number;
  branches: ReportBranchInputs[];
}

export async function readAttendanceStatementEmployeeInputs(
  tx: Tx,
  companyId: string,
  businessId: string,
  branch: { id: string; timezone: string },
  employeeId: string,
  period: StatementPeriod,
): Promise<ReportBranchInputs | null> {
  const reportRows = await tx.execute<StatementInputRow>(
    attendanceMonthlyInputsStatement(
      companyId,
      { businessId, branches: [branch], employeeId },
      period.from,
      period.to,
    ),
  );
  const scheduledRows = await tx.execute<StatementInputRow>(
    attendanceStatementScheduledEmployeesStatement(
      companyId,
      businessId,
      branch,
      period.from,
      period.to,
      employeeId,
    ),
  );
  const row = mergeAttendanceStatementRows(reportRows, scheduledRows).find(
    (entry) => entry.employee_id === employeeId,
  );
  return row?.branches[0] ?? null;
}
