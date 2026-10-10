import type { Tx } from '@pospay/db';
import {
  lockAttendanceExceptionAccess,
  readAttendanceChangeAccess,
  readAttendanceChangeApprovers,
} from '../../identity/index.ts';
import { describeWorkspaces } from '../../tenancy/index.ts';
import type { AttendanceChangeClock } from '../ports/attendance-change-transactions.port.ts';

export const attendanceChangeAuthorityLock = (tx: Tx, companyId: string) =>
  lockAttendanceExceptionAccess(tx, companyId);
export const attendanceChangeAuthority = (
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  now: Date,
) => readAttendanceChangeAccess(tx, companyId, userId, businessId, branchId, now);
export const attendanceChangeApprovers = (tx: Tx, companyId: string, now: Date) =>
  readAttendanceChangeApprovers(tx, companyId, now);

export function createAttendanceChangeReadAccess(clock: AttendanceChangeClock) {
  return {
    check: async (tx: Tx, context: { companyId: string; businessId: string; userId: string }) => {
      const tree = await describeWorkspaces(tx, [
        { scope: 'BUSINESS', scopeId: context.businessId },
      ]);
      const business =
        tree?.id === context.companyId
          ? tree.businesses.find((b) => b.id === context.businessId)
          : null;
      if (!business) return null;
      const access = await readAttendanceChangeAccess(
        tx,
        context.companyId,
        context.userId,
        context.businessId,
        business.branches.map((b) => b.id),
        clock.now(),
      );
      if (!access.owner && !access.canRequest) return null;
      return {
        owner: access.owner,
        branches: access.owner ? business.branches.map((b) => b.id) : access.branches,
      };
    },
  };
}
