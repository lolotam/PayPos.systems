/** المرحلة تحدد سبب الرفض وتمنع التحدي الاستشاري من حجز الهاتف. */
export type DeviceLockStep = 'CHALLENGE' | 'CLOCK' | 'ENROL';
/** حقائق الروابط النشطة للشخص داخل الشركة بعد الأقفال. */
export type DeviceLockFacts = {
  step: DeviceLockStep;
  heldByOther: { holderEmployeeId: string } | null;
  own: 'NONE' | 'THIS' | 'OTHER';
  bindingUnlocked: boolean;
};
/** الرفض لا يغير الحضور؛ الإرفاق مؤجل للحركة المقبولة أو التسجيل. */
export type DeviceLockDecision =
  | { kind: 'ACCEPT'; attach: boolean }
  | {
      kind: 'REFUSE';
      reason: 'DEVICE_LOCKED' | 'NOT_ENROLLED' | 'DEVICE_TAKEN' | 'OTHER_DEVICE';
      holderEmployeeId: string | null;
    };

/** يحمل قرار الرفض حتى تنتهي المعاملة؛ لا يحمل معرف التثبيت أو اعتماد الموظف. */
export class DeviceLockRefusal extends Error {
  /** يحتفظ بسبب الرفض ووقته المحقون لكتابته بعد rollback.
   *
   * @param decision قرار الرفض الخالص
   * @param at وقت الطلب المحقون
   */
  constructor(
    readonly decision: Extract<DeviceLockDecision, { kind: 'REFUSE' }>,
    readonly at: Date,
  ) {
    super(decision.reason);
  }
}

/**
 * يحمي هاتف الشخص في الاتجاهين؛ ملكية شخص آخر تسبق وجود هاتف آخر للمتقدم.
 *
 * @param facts حقائق الروابط النشطة للشركة ومرحلة الطلب
 * @returns قبول مع قرار الإرفاق أو رفض بسبب محدد وصاحب الهاتف إن وجد
 */
export function decidePasskeyDeviceLock(facts: DeviceLockFacts): DeviceLockDecision {
  if (facts.heldByOther !== null)
    return {
      kind: 'REFUSE',
      reason: facts.step === 'ENROL' ? 'DEVICE_TAKEN' : 'DEVICE_LOCKED',
      holderEmployeeId: facts.heldByOther.holderEmployeeId,
    };
  if (facts.own === 'OTHER')
    return {
      kind: 'REFUSE',
      reason: facts.step === 'ENROL' ? 'OTHER_DEVICE' : 'NOT_ENROLLED',
      holderEmployeeId: null,
    };
  return { kind: 'ACCEPT', attach: facts.step !== 'CHALLENGE' && facts.bindingUnlocked };
}
