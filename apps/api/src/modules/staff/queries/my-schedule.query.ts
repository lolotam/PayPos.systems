import type { Tx } from '@pospay/db';
import type { StaffSchedule } from '@pospay/contracts';
import { employeeScheduleStatement } from './schedule-week.query.ts';

export async function mySchedule(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  employeeId: string,
  week: string,
) {
  const [row] = await tx.execute<{ record: StaffSchedule | null }>(
    employeeScheduleStatement(companyId, businessId, branchId, employeeId, week),
  );
  return row === undefined ? ('NOT_FOUND' as const) : { schedule: row.record };
}
