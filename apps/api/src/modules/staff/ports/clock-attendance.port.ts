import type { ClockLocation, ClockResult, OpenAttendance } from '../domain/clock-attendance.ts';
import type { PasskeyScope } from './passkeys.port.ts';

/** المسح مؤقت ولا يحتوي هوية يختارها العميل. */
export interface AttendanceScan {
  token: { branch_id: string; window: number; sig: string };
  location?: ClockLocation | undefined;
}
/** نسخة العملية تثبتها معاملة الموظف قبل التحدي وتعيد فحصها عند القفل. */
export interface AttendanceAssertionScope extends PasskeyScope {
  bindingId: string;
  bindingRevision: number;
  passkeyId: string;
  branchId: string;
  operation: 'CLOCK_IN' | 'CLOCK_OUT';
  qrContext: string;
}
/** الاستجابة تتجه إلى auth فقط ولا تدخل أي صف شركة أو سجل. */
export interface AttendanceAssertion {
  id: string;
  rawId: string;
  type: 'public-key';
  authenticatorAttachment?: 'platform' | 'cross-platform' | undefined;
  clientExtensionResults: Record<string, never>;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | undefined;
  };
}
/** auth يملك UV والتحدي والعداد؛ الإثبات لا يمكن نقله إلى HTTP. */
export interface AttendancePasskeys {
  /**
   * يصدر خيارات UV لتحدي واحد مربوط بسياق العملية.
   *
   * @param scope سياق العملية الموثق
   */
  attendanceOptions(
    scope: AttendanceAssertionScope,
  ): Promise<{ challengeId: string; options: unknown }>;
  /**
   * يستهلك التحدي والعداد ذرّياً ويرجع دليلاً لا يستعمل أكثر من مرة.
   *
   * @param scope سياق العملية الموثق
   * @param challengeId معرف التحدي
   * @param response إثبات المتصفح
   */
  verifyAttendance(
    scope: AttendanceAssertionScope,
    challengeId: string,
    response: AttendanceAssertion,
  ): Promise<{ consume(scope: AttendanceAssertionScope): boolean } | null>;
}
/** التحقق يعيد فحص نافذة QR باللحظة المحقونة داخل القفل. */
export interface AttendanceScanVerifier {
  /**
   * يتحقق من الفرع والسر والتوقيت دون فتح حضور أو تغيير سياقه.
   *
   * @param companyId الشركة الموثقة
   * @param branchId فرع QR الموثق والمقفول داخل نفس المعاملة
   * @param token إثبات QR
   * @param at وقت الطلب الواحد
   * @param timezone توقيت الفرع المقفول؛ لا تفتح معاملة tenant متداخلة لقراءته
   */
  verify(
    companyId: string,
    branchId: string,
    token: AttendanceScan['token'],
    at: Date,
    timezone: string,
  ): Promise<boolean>;
}
/** المنفذ يحمي كل الكتابات والتدقيق والرد المسترجع داخل نفس المعاملة. */
export interface AttendanceTransactions {
  /**
   * يقفل State أولاً ويثبت العضوية والموظف والربط والفرع قبل تسليم السياق.
   *
   * @param scope سياق العملية الموثق
   * @param scan المسح والموقع
   * @param sample أخذ وقت واحد بعد State وكل أقفال سياق الأهلية
   * @param work العمل تحت القفل
   */
  run<T>(
    scope: PasskeyScope,
    scan: AttendanceScan,
    sample: () => Date,
    work: (tx: AttendanceTransaction, at: Date) => Promise<T>,
  ): Promise<T>;
}
/** حقائق مخزنة لا تجري حسابات الوقت أو التأخير في التخزين. */
export interface AttendanceContext {
  location: ClockLocation | undefined;
  bindingId: string;
  bindingRevision: number;
  passkeyId: string;
  timezone: string;
  geo: { lat: number; lng: number } | null;
  qrContext: string;
  lastAt: Date | null;
  lastResult: ClockResult | null;
  open: OpenAttendance | null;
  shifts: { startsAt: Date; endsAt: Date; workingDate: string }[];
}
/** نتيجة الخطة تحمل فقط الحقائق التي تكتب، لا حسبة مخفية في adapter. */
export interface AttendanceWrite {
  result: ClockResult;
  open: OpenAttendance | null;
  closeAt: Date | null;
  geo: 'OK' | 'NONE' | 'OUT_OF_RANGE';
  at: Date;
  schedule: { startsAt: Date; endsAt: Date } | null;
}
/** كل طريقة تستخدم نفس المعاملة والقفل السابق. */
export interface AttendanceTransaction {
  readonly context: AttendanceContext;
  /**
   * يسترجع سياقاً صدر لهذا الموظف والجلسة فقط، ويرفض تبديل المسح أو النسخة.
   *
   * @param id معرف التحدي
   */
  challenge(id: string): Promise<AttendanceAssertionScope | null>;
  /**
   * يربط معرف تحدي auth بسياق الشركة دون تخزين assertion.
   *
   * @param id معرف التحدي
   * @param scope سياق العملية الموثق
   */
  storeChallenge(id: string, scope: AttendanceAssertionScope): Promise<void>;
  /**
   * يسترجع الرد كما حفظ؛ مفتاح مستخدم بطلب مختلف يرفض قبل التأثير.
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
   * يكتب الانتقال والاستثناء والتدقيق والأحداث وحالة dedupe معاً.
   *
   * @param write حقائق الحركة المقبولة
   */
  persist(write: AttendanceWrite): Promise<void>;
}
