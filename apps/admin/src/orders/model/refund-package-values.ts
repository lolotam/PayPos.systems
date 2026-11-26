import { refundPackageInput, type RefundPackageInput } from '@pospay/contracts';
import { parseMoney, sumMoney } from '@pospay/domain';
import { formatKwd, type MessageKey } from '@pospay/i18n';
import type { FieldErrors, Resolver } from 'react-hook-form';

const EDGE = /^[\t\r\n ]+|[\t\r\n ]+$/g;

/** جلسة واحدة من مكوّن؛ الحالة وقيمة الجلسة المخزنة هما اللي بتحدد/free السطر. */
export interface RefundPackageSlot {
  readonly ordinal: number;
  readonly state: string;
  readonly unit_value: string;
}

/** المكوّن اللي منه الجلسات الحرة؛ العدد الحر وقيمة كل جلسة مخزنة في العرض. */
export interface RefundPackageComponent {
  readonly id: string;
  readonly name_en: string;
  readonly name_ar: string | null;
  readonly remaining: number;
  readonly slots: readonly RefundPackageSlot[];
}

/** قيم الفورم كما بتراها الشاشة؛ عدد الجلسات رقم حتى تتحقق القاعدة قبل الإرسال. */
export interface RefundPackageFormValues {
  component_id: string;
  sessions: number;
  method: 'CASH' | 'CARD';
  reason: string;
}

/** قصّ السبب من مسافات التاب والطرفين بس، زي ما الخادم بيقصه. */
export function trimRefundReason(value: string): string {
  return value.replace(EDGE, '');
}

/** الجلسات الحرة بترتيب تنازلي بالترقيم، زي اختيار الخادم بالظبط. */
export function freeRefundSlots(component: RefundPackageComponent): readonly RefundPackageSlot[] {
  return component.slots
    .filter((slot) => slot.state === 'FREE')
    .sort((a, b) => b.ordinal - a.ordinal);
}

/** عدد الجلسات الحرة المتبقية في المكوّن. */
export function remainingFreeSessions(component: RefundPackageComponent): number {
  return freeRefundSlots(component).length;
}

/**
 * مجموع أعلى الجلسات الحرة المطلوب استردادها بالملّات (bigint)؛ الحساب بالملّات مش بآرقام عشرية.
 *
 * @param component المكوّن المطلوب الاسترداد منه
 * @param sessions عدد الجلسات المطلوب استردادها
 * @returns مجموع قيمة الجلسات المختارة بالملّات
 */
export function refundPreviewMills(
  component: RefundPackageComponent | undefined,
  sessions: number,
): bigint {
  if (component === undefined || !Number.isInteger(sessions) || sessions < 1) return 0n;
  const selected = freeRefundSlots(component).slice(0, sessions);
  return selected.length < sessions
    ? 0n
    : sumMoney(selected.map((slot) => parseMoney(slot.unit_value)));
}

/** نص المبلغ المتوقع للعرض ثلاثي الكسور بالملّات. */
export function refundPreviewAmount(
  component: RefundPackageComponent | undefined,
  sessions: number,
): string {
  return formatKwd(refundPreviewMills(component, sessions));
}

/** جسم الطلب اللي بيروح للسيرفر؛ السبب مقصوص والعدد رقم صحيح. */
export function refundPackageBody(values: RefundPackageFormValues): RefundPackageInput {
  return {
    component_id: values.component_id,
    sessions: values.sessions,
    method: values.method,
    reason: trimRefundReason(values.reason),
  };
}

const CONTRACT_FIELD_MESSAGES = {
  component_id: 'componentRequired',
  method: 'methodRequired',
  reason: 'reasonRequired',
  sessions: 'sessionsRequired',
} as const;

/** تحقق الفورم: المكوّن والعدد والطريقة والسبب قبل الإرسال؛ الخادم هو الحكم النهائي. */
export function refundPackageResolver(
  components: readonly RefundPackageComponent[],
): Resolver<RefundPackageFormValues> {
  return (values) => {
    const errors: FieldErrors<RefundPackageFormValues> = {};
    const component = components.find((entry) => entry.id === values.component_id);
    if (component === undefined)
      errors.component_id = { type: 'custom', message: 'componentRequired' };
    if (!Number.isInteger(values.sessions) || values.sessions < 1) {
      errors.sessions = { type: 'custom', message: 'sessionsRequired' };
    } else if (component !== undefined && values.sessions > remainingFreeSessions(component)) {
      errors.sessions = { type: 'custom', message: 'sessionsTooMany' };
    }
    if (values.method !== 'CASH' && values.method !== 'CARD')
      errors.method = { type: 'custom', message: 'methodRequired' };
    const length = Array.from(trimRefundReason(values.reason)).length;
    if (length === 0) errors.reason = { type: 'custom', message: 'reasonRequired' };
    else if (length > 500) errors.reason = { type: 'custom', message: 'reasonTooLong' };
    if (Object.keys(errors).length > 0) return { values: {}, errors };
    const body = refundPackageBody(values);
    const parsed = refundPackageInput.safeParse(body);
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0];
      const field =
        path === 'component_id' || path === 'method' || path === 'reason' ? path : 'sessions';
      return {
        values: {},
        errors: { [field]: { type: 'custom', message: CONTRACT_FIELD_MESSAGES[field] } },
      };
    }
    return { values: body, errors: {} };
  };
}

/** رموز الرفض بتاعت السيرفر ورسائلها؛ الرمز بيقدّم على حالة HTTP. */
const REFUND_ERROR_KEYS = new Map<string, MessageKey>([
  ['FORBIDDEN', 'packageRefund.errorForbidden'],
  ['FEATURE_DISABLED', 'packageRefund.errorFeatureDisabled'],
  ['PACKAGE_NOT_FOUND', 'packageRefund.errorNotFound'],
  ['PACKAGE_COMPONENT_NOT_FOUND', 'packageRefund.errorComponentNotFound'],
  ['INSUFFICIENT_SLOTS', 'packageRefund.errorInsufficientSlots'],
  ['PACKAGE_EXPIRED', 'packageRefund.errorExpired'],
  ['IMPORTED_REFUND_DISABLED', 'packageRefund.errorImportedDisabled'],
  ['PACKAGE_REFUND_REASON_INVALID', 'packageRefund.errorReasonInvalid'],
  ['VALIDATION_FAILED', 'packageRefund.errorValidation'],
]);

/** رسالة الخطأ بالرمز؛ الشبكة والرد المؤقت بيترجموا لرسالة الشبكة عشان المحاولة تتعاد بنفس المفتاح. */
export function refundErrorMessageKey(error: unknown): MessageKey {
  const err =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown; code?: unknown })
      : {};
  const byCode = typeof err.code === 'string' ? REFUND_ERROR_KEYS.get(err.code) : undefined;
  if (byCode !== undefined) return byCode;
  const status = typeof err.status === 'number' ? err.status : undefined;
  if (status === 403) return 'packageRefund.errorForbidden';
  if (status === 404) return 'packageRefund.errorNotFound';
  if (status === undefined || status === 408 || status === 429) return 'packageRefund.errorNetwork';
  return 'packageRefund.errorGeneric';
}
