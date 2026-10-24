import type { AttendanceReportBranchInputs } from '@pospay/contracts';
import {
  attendanceMonthlyInputsStatement,
  type AttendanceReportScope,
  type Tx,
} from '@pospay/db';

export interface AttendanceReportInputRow extends Record<string, unknown> {
  employee_id: string;
  name_ar: string | null;
  name_en: string;
  employee_number: number;
  branches: AttendanceReportBranchInputs[];
}

export function attendanceMonthlyInputs(
  tx: Tx,
  companyId: string,
  scope: AttendanceReportScope,
  from: string,
  to: string,
) {
  return tx.execute<AttendanceReportInputRow>(
    attendanceMonthlyInputsStatement(companyId, scope, from, to),
  );
}
