import { SessionError } from '../../domain/session-error.ts';
import type { Clock, SessionTransaction } from '../../ports/service-session-transactions.port.ts';
import { assertRecorderAuthorizedAfterLock, resolvePackageRedemptions } from '../redeem-package-session/package-redemption-write.ts';

interface RecordPackageRequest {
  redemption: Parameters<typeof resolvePackageRedemptions>[1];
  membershipId: string;
  userId: string;
}

/** يحجب رفض الباقة عمّن فقد سلطة التسجيل أثناء الانتظار، ويمرر خطأ قاعدة البيانات دون استعلام آخر. */
export async function resolveRecordPackageRedemptions(
  tx: SessionTransaction,
  clock: Clock,
  request: RecordPackageRequest,
) {
  try {
    return await resolvePackageRedemptions(tx, request.redemption);
  } catch (error) {
    if (!(error instanceof SessionError)) throw error;
    await assertRecorderAuthorizedAfterLock(tx, clock, request.membershipId, undefined, request.userId);
    throw error;
  }
}
