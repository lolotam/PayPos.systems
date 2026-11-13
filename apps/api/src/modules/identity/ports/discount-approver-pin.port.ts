/** الجهاز اللي بيطلب موافقة الخصم — هو اللي بيتحقق منه، مش جسم الطلب. */
export interface ApproverPinDevice {
  readonly companyId: string;
  readonly deviceId: string;
  readonly branchId: string;
}

/** نتيجة التحقق: صاحب الاعتماد وإصداره، أو رفض أو قفل أو زحام. */
export type ApproverPinOutcome =
  | { readonly kind: 'ok'; readonly userId: string; readonly pinRevision: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'busy' };

/**
 * سقف الـ PIN على مستوى الجهاز (ADR-0051 §4، D-15): كل عملية من العمليات دي ذرّية في Redis، عشان
 * طلبات متوازية ما تعدّش الحد وما تمسحش قفل أحدث منها.
 */
export interface DevicePinCap {
  /**
   * بيحجز مكان للمقارنة على الجهاز قبل ما تبدأ: مقفول → locked، وإلا ok مع رقم الحجز.
   *
   * @param device الجهاز اللي بيطلب الموافقة
   */
  admit(
    device: ApproverPinDevice,
  ): Promise<{ kind: 'ok'; admission: string } | { kind: 'locked' }>;
  /**
   * بيسجّل غلطة على الجهاز وبيقفل الحجز: العدّ بيزيد لحد القفل، لكن لو الجهاز اتقفل قبل التسجيل
   * بيرجع locked من غير عدّ. و'lockedNew' معناها إن القفل الجديد ده اتعمل دلوقتي، فالمستهلك يسجّله
   * في الـ audit مرة واحدة بس.
   *
   * @param device    الجهاز اللي بيطلب الموافقة
   * @param admission رقم الحجز اللي رجع من admit
   */
  failure(
    device: ApproverPinDevice,
    admission: string,
  ): Promise<'failed' | 'locked' | 'lockedNew' | 'expired'>;
  /**
   * بيقفل الحجز ويسجّل نجاح المقارنة، وبيعيد قراءة قفل الجهاز في نفس العملية: لو اتقفل الجهاز في
   * نفس الوقت النتيجة locked. النجاح ما بيمسحش عدّاد الغلطات.
   *
   * @param device    الجهاز اللي بيطلب الموافقة
   * @param admission رقم الحجز اللي رجع من admit
   */
  success(device: ApproverPinDevice, admission: string): Promise<'ok' | 'locked' | 'expired'>;
  /**
   * بيقفل الحجز من غير ما يعدّ غلطة — لما المقارنة ما كملتش بسبب خطأ مش بسبب PIN.
   *
   * @param device    الجهاز اللي بيطلب الموافقة
   * @param admission رقم الحجز اللي رجع من admit
   */
  release(device: ApproverPinDevice, admission: string): Promise<void>;
}

/** صلاحية الجهاز وقت التحقق — جهاز مش فعال أو منتهى توكنه ما يقدرش يقرّر. */
export interface DeviceValidity {
  /**
   * بيتأكد إن الجهاز لسه فعال ومعتمد في نفس الشركة ونفس الفرع.
   *
   * @param device الجهاز اللي بيطلب الموافقة
   */
  valid(device: ApproverPinDevice): Promise<boolean>;
}
