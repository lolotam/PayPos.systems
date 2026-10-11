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
export const attendanceChangeApprovers = (
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  now: Date,
) => readAttendanceChangeApprovers(tx, companyId, businessId, branchId, now);

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
      if (!access.canDecide && !access.canRequest && !access.member) return null;
      return {
        owner: access.owner,
        member: access.member,
        canDecide: access.canDecide,
        decideBranches: access.decideBranches,
        branches: access.owner
          ? business.branches.map((b) => b.id)
          : [...new Set([...access.branches, ...access.decideBranches])],
      };
    },
  };
}
