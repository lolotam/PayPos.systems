import {
  extractOnboardingOperationId,
  MEMBER_INVITATION_KEY,
  onboardingPlaceholderEmail,
  STAFF_WELCOME_PIN_KEY,
  unsealOnboardingEmailEnvelope,
  type OnboardingEmailPayload,
} from '@pospay/notifications';

export { verifyOnboardingRecipientFresh } from './onboarding-freshness.ts';

/** لقطة المحاولة اللي كفاية لفك المظروف: الشركة والقالب والوجهة الموقّعة والمعاملات المسمّاة. */
export interface OnboardingEnvelopeAttempt {
  readonly companyId: string;
  readonly templateKey: string;
  readonly templateRevision: number;
  readonly email?: string | null | undefined;
  readonly safeParameters: readonly {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly value?: unknown;
  }[];
}

/** بريد الترحيب ودعوة العضو: قالبان بيتفكوا من مظروف مشفّر بدل معاملات عادية. */
const ONBOARDING_TEMPLATE_KEYS: ReadonlySet<string> = new Set([
  STAFF_WELCOME_PIN_KEY,
  MEMBER_INVITATION_KEY,
]);

/**
 * يفحص إن المفتاح قالب ترحيب: بريد الترحيب بالموظفة أو دعوة العضو.
 *
 * @param key مفتاح القالب
 * @returns true لما القالب من قوالب الترحيب
 */
export function isOnboardingTemplate(key: string): boolean {
  return ONBOARDING_TEMPLATE_KEYS.has(key);
}

/**
 * يفك مظروف إيميل الترحيب: مربوط بالشركة والعملية والقالب والوجهة الموقّعة، وبيرفض أي تزوير أو انتهاء.
 *
 * @param attempt لقطة المحاولة
 * @param key مفتاح الختم
 * @param now اللحظة الحالية
 * @param options خيارات فك التشفير (تعطيل فحص العمر مطلوب فقط لمطابقة الوجهة)
 * @returns الحمولة، أو null لما المظروف مش سليم أو انتهى
 */
export function unsealAttempt(
  attempt: OnboardingEnvelopeAttempt,
  key: Buffer,
  now: Date,
  options: { readonly checkExpiry?: boolean } = {},
): OnboardingEmailPayload | null {
  const placeholder = attempt.email;
  const operationId = extractOnboardingOperationId(attempt.safeParameters);
  if (typeof placeholder !== 'string' || placeholder === '' || operationId === null) return null;
  return unsealOnboardingEmailEnvelope(
    key,
    attempt.safeParameters,
    {
      companyId: attempt.companyId,
      operationId,
      templateKey: attempt.templateKey,
      templateRevision: attempt.templateRevision,
      placeholderEmail: placeholder,
    },
    now,
    options,
  );
}

/**
 * يشوف إن الوجهة الموقّعة بتاعة المحاولة بتطابق البريد الحقيقي اللي جوا المظروف.
 *
 * @param payload الحمولة بعد فك المظروف
 * @param destination الوجهة الموقّعة المحفوظة في المحاولة
 * @param key مفتاح الختم
 * @returns true لما الوجهة بتطابق
 */
export function onboardingDestinationMatches(
  payload: OnboardingEmailPayload,
  destination: string,
  key: Buffer,
): boolean {
  return onboardingPlaceholderEmail(payload.email, key) === destination;
}

/** يفك مظروف إيميل الترحيب وقت الإرسال: البريد الحقيقي والحمولة، في الذاكرة بس. */
export type OnboardingResolver = (
  attempt: OnboardingEnvelopeAttempt,
) => { readonly email: string; readonly payload: OnboardingEmailPayload } | null;
