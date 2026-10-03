/** حالات المحاولة؛ التنفيذ غير المعروف لا يعود للإذن. */
export type AttemptStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'EXPIRED' | 'SUPPRESSED';
/** أسباب محدودة آمنة للتشخيص دون الوجهة أو جسم المزود. */
export type FailureCode =
  | 'LOCALE_MISSING'
  | 'LOCALE_UNSUPPORTED'
  | 'DESTINATION_INVALID'
  | 'CONFIG_INVALID'
  | 'PARAMETERS_INVALID'
  | 'ADMISSION_REFUSED'
  | 'DEADLINE_EXPIRED'
  | 'SUPPRESSED'
  | 'PROVIDER_4XX'
  | 'PROVIDER_5XX'
  | 'NETWORK_UNKNOWN'
  | 'RESPONSE_INVALID';
/** لغة صريحة مدعومة بلا اختيار بديل. */
export type Locale = 'ar' | 'en';
/** قيمة مرتبة اجتازت قائمة القالب الآمنة بلا كود أو رابط حامل. */
export interface SafeParameter {
  readonly name: string;
  readonly type: 'text' | 'number';
  readonly value: string | number;
}
/** هوية وجهة منصة ثابتة؛ لاحقة الهاتف فارغة للبريد ونتيجة التحقق لا تستعيد الوجهة. */
export interface PhoneIdentity {
  readonly hash: Uint8Array;
  readonly hashKeyId: string;
  readonly last3: string;
  readonly valid: boolean;
}
/** لقطة طلب المنتج؛ لا يقرأ الموديول جهات الاتصال. */
export interface NotificationInput {
  readonly companyId: string;
  readonly sourceEventId: string;
  readonly businessId: string | null;
  readonly branchId: string | null;
  readonly phone: string;
  readonly email?: string | null;
  readonly identity: PhoneIdentity;
  readonly locale: string | null;
  readonly channel: 'whatsapp' | 'email';
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly providerTemplateName: string | null;
  readonly safeParameters: readonly SafeParameter[];
  readonly deadline: Date | null;
  readonly configurationFailure: FailureCode | null;
}
/** لقطة المحاولة الدائمة وسياج التنفيذ مع الوجهة المؤقتة. */
export interface Attempt extends Omit<
  NotificationInput,
  'locale' | 'configurationFailure' | 'phone'
> {
  readonly id: string;
  readonly locale: Locale | null;
  readonly phone: string | null;
  readonly status: AttemptStatus;
  readonly authorizedAt: Date;
  readonly executionId: string | null;
  readonly sendingAt: Date | null;
}
/** نتيجة نهائية تسجل مع مسح الوجهة وحدث النتيجة. */
export interface TerminalResult {
  readonly status: 'SENT' | 'FAILED' | 'EXPIRED' | 'SUPPRESSED';
  readonly failureCode: FailureCode | null;
  readonly outcomeKnown: boolean;
  readonly providerMessageId: string | null;
}
/** دليل تقديم واحد؛ القبول يثبت قبول المزود فقط ولا يثبت وصول الهاتف. */
export type SubmissionResult =
  | { readonly kind: 'accepted'; readonly providerMessageId: string }
  | { readonly kind: 'expired' }
  | { readonly kind: 'rejected'; readonly code: 'PROVIDER_4XX'; readonly outcomeKnown: true }
  | {
      readonly kind: 'unknown';
      readonly code: 'PROVIDER_5XX' | 'NETWORK_UNKNOWN' | 'RESPONSE_INVALID';
      readonly outcomeKnown: false;
    };
/** قرار الإذن أو الرفض الذي يحفظ اللغة وسبب الرفض. */
export type AuthorizationDecision =
  | { readonly status: 'PENDING'; readonly locale: Locale; readonly failureCode: null }
  | {
      readonly status: 'FAILED' | 'EXPIRED' | 'SUPPRESSED';
      readonly locale: Locale | null;
      readonly failureCode: FailureCode;
    };

/**
 * يحدد نهاية المحاولة كي تبقى الوجهة فقط أثناء الإذن والتنفيذ غير المعروف.
 *
 * @param status حالة المحاولة
 * @returns هل الحالة نهائية
 */
export function isTerminal(status: AttemptStatus): boolean {
  return ['SENT', 'FAILED', 'EXPIRED', 'SUPPRESSED'].includes(status);
}

/**
 * يمنع أي رجوع للإذن بعد التنفيذ، لأن عدم اليقين لا يسمح بإرسال ثانٍ.
 *
 * @param from الحالة الحالية
 * @param to الحالة التالية
 * @returns هل الانتقال يحافظ على الإرسال مرة واحدة
 */
export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  if (isTerminal(from)) return false;
  return from === 'PENDING'
    ? ['SENDING', 'FAILED', 'EXPIRED'].includes(to)
    : ['SENT', 'FAILED', 'EXPIRED'].includes(to);
}

/**
 * يرفض اللغة المفقودة أو غير المدعومة قبل أي قرار آخر ولا يستخدم لغة بديلة.
 *
 * @param input الطلب وتاريخ الانتهاء والتحقق المحلي
 * @param now الوقت المتحقن وقت الإذن
 * @param suppressed قرار المنع تحت قفل الهاتف نفسه
 * @returns الحالة الأولية واللغة ورمز الرفض
 */
export function authorizationDecision(
  input: NotificationInput,
  now: Date,
  suppressed: boolean,
): AuthorizationDecision {
  if (input.locale === null || input.locale === '')
    return { status: 'FAILED', locale: null, failureCode: 'LOCALE_MISSING' };
  if (input.locale !== 'ar' && input.locale !== 'en')
    return { status: 'FAILED', locale: null, failureCode: 'LOCALE_UNSUPPORTED' };
  const locale = input.locale;
  if (input.deadline !== null && now.getTime() >= input.deadline.getTime())
    return { status: 'EXPIRED', locale, failureCode: 'DEADLINE_EXPIRED' };
  if (!input.identity.valid)
    return { status: 'FAILED', locale, failureCode: 'DESTINATION_INVALID' };
  if (suppressed) return { status: 'SUPPRESSED', locale, failureCode: 'SUPPRESSED' };
  if (input.configurationFailure !== null)
    return { status: 'FAILED', locale, failureCode: input.configurationFailure };
  return { status: 'PENDING', locale, failureCode: null };
}

/**
 * يسجل الرفض المحلي دون اختلاق دليل من المزود.
 *
 * @param code سبب الرفض المحدود
 * @returns نتيجة نهائية بلا معرّف مزود
 */
export function refusedResult(code: FailureCode): TerminalResult {
  return {
    status:
      code === 'DEADLINE_EXPIRED' ? 'EXPIRED' : code === 'SUPPRESSED' ? 'SUPPRESSED' : 'FAILED',
    failureCode: code,
    outcomeKnown: true,
    providerMessageId: null,
  };
}

/**
 * يحوّل دليل التقديم إلى الحالة النهائية؛ عدم اليقين لا يسمح بإعادة الإرسال.
 *
 * @param result نتيجة تقديم واحدة من القناة بلا جسم مزود
 * @returns نتيجة نهائية بدليل قبول أو رفض أو عدم يقين
 */
export function submissionResult(result: SubmissionResult): TerminalResult {
  if (result.kind === 'expired') return refusedResult('DEADLINE_EXPIRED');
  if (result.kind === 'accepted')
    return {
      status: 'SENT',
      failureCode: null,
      outcomeKnown: true,
      providerMessageId: result.providerMessageId,
    };
  return {
    status: 'FAILED',
    failureCode: result.code,
    outcomeKnown: result.outcomeKnown,
    providerMessageId: null,
  };
}
