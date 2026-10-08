import type { Tx } from '@pospay/db';
import {
  lockAttendanceExceptionAccess,
  readAttendanceExceptionAccess,
} from '../../identity/index.ts';

export const attendanceExceptionAuthorityLock = (tx: Tx, companyId: string) =>
  lockAttendanceExceptionAccess(tx, companyId);
export const attendanceExceptionAuthority = (
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  now: Date,
) => readAttendanceExceptionAccess(tx, companyId, userId, businessId, branchId, now);
