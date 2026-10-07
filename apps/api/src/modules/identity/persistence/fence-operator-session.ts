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
  /**
   * يعيد فحص الجلسة بعد قراءة صفها. موعد الانتهاء من ساعة الاعتماد لا من المستدعي.
   *
   * @param proof هوية الجلسة والموعد والجهاز
   */
  confirmCurrent(proof: StaffSessionProof): Promise<void>;
}

/**
 * يثبت أن جلسة المشغل ما زالت الجلسة الحية للجهاز.
 * القفل نفسه الذي يستخدمه تدوير جلسة الوردية، فيُنتظر تسجيل الخروج أو يفوز.
 * موعد الثماني ساعات يُقرأ من ساعة الاعتماد بعد هذا القفل وبعد قراءة الجلسة.
 *
 * @param tx معاملة الشركة التي تحتفظ بالقفل حتى الإتمام
 * @param sessions فاحص الجلسات، أو null عند غياب التجهيز
 * @param proof هوية الجلسة والموعد والجهاز المحمولة من الحارس
 */
export async function fenceOperatorSession(
  tx: Tx,
  sessions: OperatorSessionCheck | null,
  proof: StaffSessionProof,
): Promise<void> {
  if (sessions === null) throw new OperatorSessionEnded();
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${staffDeviceSessionLockKey(proof.device.deviceId)}, 0))`,
  );
  try {
    await sessions.confirmCurrent(proof);
  } catch (error) {
    if (error instanceof StaffSessionEnded) throw new OperatorSessionEnded();
    throw error;
  }
}
