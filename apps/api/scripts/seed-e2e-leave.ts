import { civilDate } from '../../admin/e2e/civil-date.ts';

import { idOf, postJson, type SeedTarget } from './seed-e2e-http.ts';

function revisionOf(body: Record<string, unknown>): number {
  const revision = body['revision'];
  if (typeof revision !== 'number') throw new Error('e2e:seed leave revision missing');
  return revision;
}

export async function approveLeave(
  target: SeedTarget,
  cookie: string,
  leave: {
    readonly companyId: string;
    readonly businessId: string;
    readonly branchId: string;
    readonly employeeId: string;
    readonly timeZone: string;
  },
): Promise<void> {
  const root = `/v1/businesses/${leave.businessId}/employees/${leave.employeeId}/leave-requests`;
  const created = await postJson(target, root, cookie, leave.companyId, {
    kind: 'FULL_DAY',
    type: 'ANNUAL',
    from: civilDate(leave.timeZone, -1),
    to: civilDate(leave.timeZone, 1),
    branch_id: leave.branchId,
  });
  const decided = await postJson(target, `${root}/${idOf(created, root)}/decide`, cookie, leave.companyId, {
    decision: 'APPROVED',
    expected_revision: revisionOf(created),
  });
  if (decided['status'] !== 'APPROVED') throw new Error('e2e:seed leave not approved');
}
