import type { Tx } from '@pospay/db';
import {
  lockAttendanceExceptionAccess,
  readAttendanceCorrectionAccess,
} from '../../identity/index.ts';

export const attendanceCorrectionAuthorityLock = (tx: Tx, companyId: string) =>
  lockAttendanceExceptionAccess(tx, companyId);
export const attendanceCorrectionAuthority = (
  tx: Tx,
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string,
  now: Date,
) => readAttendanceCorrectionAccess(tx, companyId, userId, businessId, branchId, now);
