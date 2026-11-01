/** نطاق النافذة مثبت من جلسة المشغل، وليس من موظف يختاره العميل. */
export interface PrivateViewScope {
  readonly sessionId: string;
  readonly userId: string;
  readonly deviceId: string;
}

const PROOF: unique symbol = Symbol('private-view-proof');

/** دليل PIN داخلي أحادي الاستعمال؛ نوعه فقط يعبر حدود الحزمة ولا يُخزن أو يُنقل عبر HTTP. */
export interface PrivateViewProof {
  readonly [PROOF]: true;
}

interface ProofState {
  readonly verifiedAtMs: number;
  readonly scope: PrivateViewScope;
}

const states = new WeakMap<PrivateViewProof, ProofState>();

/**
 * يحفظ نتيجة مقارنة PIN الناجحة في ذاكرة مغلقة حتى لا يصنع النوع المُلقّى دليلاً صالحاً.
 *
 * @param scope نطاق الجلسة والمشغل والجهاز الذي خضع للإثبات
 * @param verifiedAt وقت نجاح المقارنة من ساعة الاعتماد
 * @returns دليلاً أحادي الاستعمال مرتبطاً بالنطاق المجمد
 */
export function mintPrivateViewProof(
  scope: PrivateViewScope,
  verifiedAt: Date,
): PrivateViewProof {
  const proof = { [PROOF]: true } as PrivateViewProof;
  states.set(proof, {
    verifiedAtMs: verifiedAt.getTime(),
    scope: Object.freeze({ ...scope }),
  });
  return proof;
}

/**
 * يصرف الدليل قبل أي انتظار ولا يعيده عند فشل الفتح، لأن إعادته تسمح بإعادة استعماله.
 *
 * @param proof الدليل الذي طلبه المستهلك
 * @returns وقت الإثبات والنطاق مرة واحدة فقط، أو null لدليل مزور أو مصروف
 */
export function consumePrivateViewProof(proof: PrivateViewProof): ProofState | null {
  const state = states.get(proof) ?? null;
  if (state !== null) states.delete(proof);
  return state;
}

/**
 * يقارن النطاق بالمحتوى حتى لا ينتقل إثبات مشغل إلى جلسة أو مستخدم أو جهاز آخر.
 *
 * @param left النطاق المثبت داخل الدليل
 * @param right النطاق المطلوب فتحه
 * @returns true فقط عند تطابق المعرّفات الثلاثة
 */
export function samePrivateViewScope(
  left: PrivateViewScope,
  right: PrivateViewScope,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.userId === right.userId &&
    left.deviceId === right.deviceId
  );
}
