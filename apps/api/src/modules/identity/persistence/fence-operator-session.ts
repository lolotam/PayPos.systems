import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { StaffSessionEnded, staffDeviceSessionLockKey, type StaffSessionProof } from '@pospay/auth';

/** رفض الجلسة المنتهية أو المستبدلة بلا أثر حضور. */
export class OperatorSessionEnded extends Error {
  override readonly name = 'OperatorSessionEnded';
  readonly code = 'UNAUTHENTICATED' as const;
}

/** فاحص الجلسة المملوك للاعتماد؛ الغياب يعني أن المسار غير جاهز. */
export interface OperatorSessionCheck {
  confirmCurrent(proof: StaffSessionProof, now: Date): Promise<void>;
}

/**
 * يثبت أن جلسة المشغل ما زالت الجلسة الحية للجهاز قبل أي أثر حضور.
 * القفل نفسه الذي يستخدمه تدوير جلسة الوردية، فيُنتظر تسجيل الخروج أو يفوز.
 *
 * @param tx معاملة الشركة التي تحتفظ بالقفل حتى الإتمام
 * @param sessions فاحص الجلسات، أو null عند غياب التجهيز
 * @param proof هوية الجلسة والموعد المحمولان من الحارس
 * @param now اللحظة المأخوذة بعد قفل حالة الحضور
 */
export async function fenceOperatorSession(
  tx: Tx,
  sessions: OperatorSessionCheck | null,
  proof: StaffSessionProof,
  now: Date,
): Promise<void> {
  if (sessions === null) throw new OperatorSessionEnded();
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${staffDeviceSessionLockKey(proof.device.deviceId)}, 0))`,
  );
  try {
    await sessions.confirmCurrent(proof, now);
  } catch (error) {
    if (error instanceof StaffSessionEnded) throw new OperatorSessionEnded();
    throw error;
  }
}
