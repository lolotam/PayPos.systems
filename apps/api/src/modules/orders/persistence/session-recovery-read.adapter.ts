import type { Tx } from '@pospay/db';
import { sessionRecordAccess } from './session-record-access.adapter.ts';
import { sessionBranchBelongs } from './session-place.adapter.ts';

// القراءة بلا recorder_membership_id؛ القائمة أصلاً مقصورة على app_user_id() فلا نطلب عضوية واحدة.
export async function sessionRecoveryPlace(tx: Tx, companyId: string, businessId: string, branchId: string): Promise<boolean> {
  return sessionBranchBelongs(tx, companyId, businessId, branchId);
}
export async function sessionRecoveryRecord(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, at: Date): Promise<'ALLOWED' | 'DENIED' | 'FEATURE_DISABLED'> {
  const access = await sessionRecordAccess(tx, companyId, userId, businessId, branchId).read(at);
  if (access.denied || !access.record) return 'DENIED';
  if (!access.feature) return 'FEATURE_DISABLED';
  return 'ALLOWED';
}
