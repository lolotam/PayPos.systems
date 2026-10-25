import type { Tx } from '@pospay/db';

import { attendanceReportWorkplaces } from './schedule-context.adapter.ts';

// فرع المسار ومنطقته الفعالة؛ التفرع بين الفروع بيحتاج معاملة المستأجر نفسها، فمفيش معاملة هنا.
export async function readStatementBranch(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): Promise<{ id: string; timezone: string } | null> {
  const workplaces = await attendanceReportWorkplaces(tx, companyId, businessId, branchId);
  return workplaces?.branches[0] ?? null;
}
