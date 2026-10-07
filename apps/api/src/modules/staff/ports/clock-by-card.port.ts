import type { ClockLocation, ClockResult, OpenAttendance } from '../domain/clock-attendance.ts';

/** نطاق حركة الكارت: الجهاز المثبت والعامل المسجّل، والفرع من الجهاز لا من الطلب. */
export interface CardClockScope {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly operatorId: string;
}
/** حقائق الجلسة المحمّلة بعد الأقفال؛ لا ربط passkey ولا نافذة QR في مسار الكارت. */
export interface CardClockContext {
  readonly timezone: string;
  readonly geo: { lat: number; lng: number } | null;
  readonly location: ClockLocation | undefined;
  readonly lastAt: Date | null;
  readonly lastResult: ClockResult | null;
  readonly open: OpenAttendance | null;
  readonly shifts: readonly { startsAt: Date; endsAt: Date; workingDate: string }[];
}
/** ما يقرره الـ use case من الدومين وتكتبه المعاملة؛ لا حساب داخل التخزين. */
export interface CardClockWrite {
  readonly result: ClockResult;
  readonly open: OpenAttendance | null;
  readonly closeAt: Date | null;
  readonly geo: 'OK' | 'NONE' | 'OUT_OF_RANGE';
  readonly at: Date;
  readonly schedule: { startsAt: Date; endsAt: Date } | null;
}
/** كل طريقة تستخدم نفس المعاملة والقفل السابق. */
export interface CardClockTransaction {
  readonly context: CardClockContext;
  /**
   * يسترجع الرد كما حفظ؛ مفتاح مستخدم بجسم مختلف يرفض قبل التأثير.
   *
   * @param key مفتاح منع التكرار
   * @param fingerprint بصمة الطلب
   * @param work العمل تحت القفل
   */
  idempotent(
    key: string,
    fingerprint: string,
    work: () => Promise<ClockResult>,
  ): Promise<ClockResult>;
  /**
   * يكتب الحركة والتدقيق والحدث وحالة dedupe معاً.
   *
   * @param write حقائق الحركة المقبولة
   */
  persist(write: CardClockWrite): Promise<void>;
}
/** المنفذ يحمي قفل الكارت والحالة والأهلية والكتابة داخل معاملة واحدة. */
export interface CardClockTransactions {
  /**
   * يحدد الموظف بقراءة الكارت ثم يقفل State والشركة والعضويات والجهاز والموظف والفرع، ويثبت الكارت قبل الحركة.
   *
   * @param scope نطاق الجهاز والعامل
   * @param cardCode الكود الممسوح بعد التطبيع
   * @param sample أخذ وقت واحد بعد القفل والإذن
   * @param work العمل تحت القفل
   */
  run<T>(
    scope: CardClockScope,
    cardCode: string,
    sample: () => Date,
    work: (tx: CardClockTransaction, at: Date) => Promise<T>,
  ): Promise<T>;
}
