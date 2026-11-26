import { canonicalEmail } from './email-identity.ts';
import { NOTIFICATION_HASH_KEY_ID } from './identifier-patterns.ts';
import { renderOperationalEmail } from './templates/email-operational.ts';

/** أسباب تعطيل قناة البريد: كل سبب يسمّي المجموعة الناقصة وما بيقولش أي قيمة. */
export type EmailDisabledReason =
  | 'EMAIL_HASH_KEY_MISSING_OR_INVALID'
  | 'RESEND_API_KEY_MISSING'
  | 'EMAIL_FROM_ADDRESS_INVALID'
  | 'EMAIL_FROM_NAME_INVALID'
  | 'EMAIL_REPLY_TO_INVALID'
  | 'EMAIL_ADMIN_ORIGIN_INVALID'
  | 'EMAIL_FEEDBACK_DB_MISSING'
  | 'EMAIL_FEEDBACK_UNAVAILABLE';

/** إعداد قناة البريد: مفعّلة أو معطّلة بسبب محدود؛ القيم السرّية بتظهر بس في حالة الإغلاق الصريح. */
export interface EmailConfiguration {
  readonly enabled: boolean;
  readonly reason: EmailDisabledReason | null;
  readonly hashKey?: string;
  readonly hashKeyId?: string;
  readonly apiKey?: string;
  readonly fromAddress?: string;
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly adminOrigin?: string;
}

const MINIMUM_HASH_KEY_LENGTH = 32;
const SENDING_DOMAIN = '@send.pospay.systems';

/**
 * يقرأ إعداد قناة البريد من البيئة ويحدد أول مجموعة ناقصة بدون تسريب أي سرّ،
 * مع إبقاء مفتاح البصمة متاحًا للتحقق من الهوية حتى أثناء تعطيل الإرسال.
 */
export function readEmailConfiguration(
  env: NodeJS.ProcessEnv,
  options?: { readonly feedbackReady?: boolean },
): EmailConfiguration {
  const hashKey = env['NOTIFICATION_EMAIL_HASH_KEY'] ?? '';
  const hashKeyId = env['NOTIFICATION_EMAIL_HASH_KEY_ID'] ?? '';
  const adminOrigin = env['EMAIL_ADMIN_ORIGIN'] ?? '';
  const validHash = validHashKey(hashKey, hashKeyId);
  const validOrigin = validAdminOrigin(adminOrigin);
  const reason = firstMissingGroup(env, validHash, validOrigin, options);
  if (reason !== null)
    return {
      enabled: false,
      reason,
      ...(validHash ? { hashKey, hashKeyId } : {}),
      ...(validOrigin ? { adminOrigin } : {}),
    };
  return {
    enabled: true,
    reason: null,
    hashKey,
    hashKeyId,
    apiKey: env['RESEND_API_KEY'] ?? '',
    fromAddress: env['EMAIL_FROM_ADDRESS'] ?? '',
    fromName: env['EMAIL_FROM_NAME'] ?? '',
    replyTo: env['EMAIL_REPLY_TO'] ?? '',
    adminOrigin,
  };
}

/** أول مجموعة ناقصة بالترتيب؛ مفيش قيمة بتتسرب في السبب. */
function firstMissingGroup(
  env: NodeJS.ProcessEnv,
  validHash: boolean,
  validOrigin: boolean,
  options?: { readonly feedbackReady?: boolean },
): EmailDisabledReason | null {
  if (!validHash) return 'EMAIL_HASH_KEY_MISSING_OR_INVALID';
  const apiKey = env['RESEND_API_KEY'] ?? '';
  if (apiKey === '' || /[\r\n]/.test(apiKey)) return 'RESEND_API_KEY_MISSING';
  const fromAddress = env['EMAIL_FROM_ADDRESS'] ?? '';
  if (canonicalEmail(fromAddress) !== fromAddress || !fromAddress.endsWith(SENDING_DOMAIN))
    return 'EMAIL_FROM_ADDRESS_INVALID';
  const fromName = env['EMAIL_FROM_NAME'] ?? '';
  if (fromName.trim() === '' || /[\r\n<>]/.test(fromName)) return 'EMAIL_FROM_NAME_INVALID';
  const replyTo = env['EMAIL_REPLY_TO'] ?? '';
  if (replyTo === '' || canonicalEmail(replyTo) !== replyTo) return 'EMAIL_REPLY_TO_INVALID';
  if (!validOrigin) return 'EMAIL_ADMIN_ORIGIN_INVALID';
  if (!validDatabaseUrl(env['PLATFORM_NOTIFICATIONS_DATABASE_URL'] ?? ''))
    return 'EMAIL_FEEDBACK_DB_MISSING';
  if (options?.feedbackReady === false) return 'EMAIL_FEEDBACK_UNAVAILABLE';
  return null;
}

/** مفتاح البصمة: 32 حرف على الأقل وبلا سطر جديد، ومعرّفه بالشكل المحدد. */
function validHashKey(hashKey: string, hashKeyId: string): boolean {
  return (
    hashKey.length >= MINIMUM_HASH_KEY_LENGTH &&
    !/[\r\n]/.test(hashKey) &&
    NOTIFICATION_HASH_KEY_ID.test(hashKeyId)
  );
}

/** أصل اللوحة: لازم يكون أصل معروف يقبله القالب نفسه. */
function validAdminOrigin(adminOrigin: string): boolean {
  return renderOperationalEmail('document_expiring', 1, 'en', [], adminOrigin) !== null;
}

/** رابط قاعدة بيانات المنصة: postgres أو postgresql بس. */
function validDatabaseUrl(value: string): boolean {
  try {
    return ['postgres:', 'postgresql:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
