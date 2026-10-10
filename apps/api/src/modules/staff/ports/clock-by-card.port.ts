import type { ClockLocation, ClockResult, OpenAttendance } from '../domain/clock-attendance.ts';

/** نطاق حركة الكارت: الجهاز المثبت والعامل المسجّل، ومعهما هوية جلسته وموعدها المطلق. */
export interface CardClockScope {
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly deviceId: string;
  readonly operatorId: string;
  readonly sessionId: string;
  readonly sessionDeadline: Date;
}
/** مفتاح المسح وبصمة جسمه قبل ربطها بالجهاز والعامل داخل HMAC الساعة. */
export interface CardClockIdempotency {
  readonly key: string;
  readonly fingerprint: string;
}
/** حقائق الجلسة المحمّلة بعد الأقفال؛ لا ربط passkey ولا نافذة QR في مسار الكارت. */
export interface CardClockContext {
  readonly timezone: string;
  readonly geo: { lat: number; lng: number } | null;
  readonly location: ClockLocation | undefined;
  readonly lastAt: Date | null;
  readonly lastResult: ClockResult | null;
  readonly open: OpenAttendance | null;
  readonly shifts: readonly {
    startsAt: Date;
    endsAt: Date;
    workingDate: string;
    breakStartsAt?: Date | null;
    breakEndsAt?: Date | null;
    returning?: boolean;
  }[];
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
   * يثبت أن جلسة المشغل ما زالت حية ولم تُستبدل.
   * ساعة الاعتماد تُقرأ بعد قفل الجهاز وبعد قراءة الجلسة، لا من وقت المسح.
   * يُستدعى داخل أثر المفتاح حتى يعيد التكرار الرد المحفوظ، ويُرفض اختلاف البصمة قبله.
   */
  confirmOperator(): Promise<void>;
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
   * يعيد الحركة المخزّنة لمفتاح مكتمل بنفس البصمة المربوطة بالجهاز والعامل عندما يغيب مؤشر Redis، دون كتابة.
   *
   * @param scope نطاق الجهاز والعامل
   * @param idem مفتاح منع التكرار وبصمة الطلب
   * @returns الحركة المخزّنة، أو null إن لم تكتمل نفس البصمة
   */
  completed(scope: CardClockScope, idem: CardClockIdempotency): Promise<ClockResult | null>;
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
