import { createHmac } from 'node:crypto';
import { createOtpCrypto, type OtpKeys } from '../staff-otp/crypto.ts';
import { otpKeyRing } from '../staff-otp/configuration.ts';

/**
 * إعداد اعتماد الاسترجاع بالإيميل: مستقل تماماً عن اعتماد الواتساب (BR-004).
 * جاهز يعني إن قاعدة الهوية وRedis ومفاتيح الرمز ومفتاح بصمة الإيميل كلهم موجودين.
 */
export type EmailOtpConfiguration =
  | { readonly state: 'DISABLED' | 'UNAVAILABLE'; readonly reason: string }
  | {
      readonly state: 'READY';
      readonly keys: OtpKeys;
      readonly fingerprint: string;
    };

/**
 * يقرأ إعداد اعتماد الاسترجاع بالإيميل من البيئة. أي نقص في المفاتيح أو العناوين بيقفل
 * الاعتماد بس، من غير أثر على خدمة أو جاهزية تانية.
 *
 * @param env بيئة العملية
 * @returns حالة الإعداد مع مفاتيح الرمز وبصمة الإعداد
 */
export function readEmailOtpConfiguration(env: NodeJS.ProcessEnv): EmailOtpConfiguration {
  if (!env['AUTH_DATABASE_URL'] || !env['REDIS_URL'])
    return { state: 'UNAVAILABLE', reason: 'DEPENDENCIES_MISSING' };
  if (
    (env['NOTIFICATION_EMAIL_HASH_KEY']?.length ?? 0) < 32 ||
    !env['NOTIFICATION_EMAIL_HASH_KEY_ID'] ||
    (env['NOTIFICATION_MESSAGE_ID_HASH_KEY']?.length ?? 0) < 32
  )
    return { state: 'UNAVAILABLE', reason: 'EMAIL_KEYS_MISSING' };
  try {
    const keys: OtpKeys = {
      derivationId: env['STAFF_OTP_DERIVATION_KEY_ID'] ?? '',
      verificationId: env['STAFF_OTP_VERIFICATION_KEY_ID'] ?? '',
      derivation: otpKeyRing(env, 'DERIVATION'),
      verification: otpKeyRing(env, 'VERIFICATION'),
    };
    createOtpCrypto(keys);
    return { state: 'READY', keys, fingerprint: configurationFingerprint(env, keys) };
  } catch {
    return { state: 'UNAVAILABLE', reason: 'LIVE_CONFIGURATION_INCOMPLETE' };
  }
}

/** بصمة الإعداد: API والworker لازم يتكلموا عن نفس المفاتيح ونفس بصمة الإيميل. */
function configurationFingerprint(env: NodeJS.ProcessEnv, keys: OtpKeys): string {
  const key = keys.verification.get(keys.verificationId);
  if (key === undefined) throw new Error('OTP_KEY_UNAVAILABLE');
  return createHmac('sha256', key)
    .update('pospay:email-otp:configuration:v1\0')
    .update(
      JSON.stringify({
        derivation: [...keys.derivation].map(([id, k]) => [id, Buffer.from(k).toString('base64')]),
        verification: [...keys.verification].map(([id, k]) => [
          id,
          Buffer.from(k).toString('base64'),
        ]),
        emailKey: env['NOTIFICATION_EMAIL_HASH_KEY'],
        emailKeyId: env['NOTIFICATION_EMAIL_HASH_KEY_ID'],
        messageKey: env['NOTIFICATION_MESSAGE_ID_HASH_KEY'],
      }),
    )
    .digest('hex');
}
