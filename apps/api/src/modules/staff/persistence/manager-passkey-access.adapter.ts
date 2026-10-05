import type { Tx } from '@pospay/db';
import { lockPasskeyAccess, readPasskeyAccess } from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';
import { scheduleToday } from '../domain/schedule-calendar.ts';
import type { PasskeyAccessClock } from '../ports/unbind-passkey.port.ts';
async function businessBranches(tx: Tx, companyId: string, businessId: string) {
  const tree = await describeWorkspaces(tx, [{ scope: 'BUSINESS', scopeId: businessId }]);
  return tree?.id === companyId
    ? (tree.businesses.find((business) => business.id === businessId)?.branches ?? [])
    : [];
}
export function createManagerPasskeyAccess(clock: PasskeyAccessClock) {
  return {
    now: () => clock.now(),
    lock: (tx: Tx, companyId: string) => lockPasskeyAccess(tx, companyId),
    check: (
      tx: Tx,
      companyId: string,
      userId: string,
      businessId: string,
      branchIds: readonly string[],
      now: Date,
    ) => readPasskeyAccess(tx, companyId, userId, businessId, branchIds, now),
    list: async (tx: Tx, companyId: string, userId: string, businessId: string, now: Date) => {
      const branches = await businessBranches(tx, companyId, businessId);
      return readPasskeyAccess(
        tx,
        companyId,
        userId,
        businessId,
        branches.map((branch) => branch.id),
        now,
      );
    },
    branchDays: async (tx: Tx, companyId: string, businessId: string, now: Date) => {
      return (await businessBranches(tx, companyId, businessId)).map((branch) => ({
        branchId: branch.id,
        today: scheduleToday(now, branch.effective_timezone),
      }));
    },
  };
}
