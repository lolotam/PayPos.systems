import type { Tx } from '@pospay/db';

import type { AttendanceStatementShiftBranch } from '../queries/attendance-statement-shifts.query.ts';

export const ATTENDANCE_STATEMENT_BRANCH_READ = Symbol('ATTENDANCE_STATEMENT_BRANCH_READ');

// المسار بيحتاج يقرأ الفرع من معاملة القراءة، وطبقة الحفظ مش منصوص عليه يستوردها.
export type AttendanceStatementBranchRead = (
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
) => Promise<AttendanceStatementShiftBranch | null>;
