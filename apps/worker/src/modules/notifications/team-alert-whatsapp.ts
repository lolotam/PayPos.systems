import { randomBytes } from 'node:crypto';
import type { Tx } from '@pospay/db';
import { createPhoneIdentity } from '@pospay/notifications';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import { createAuthorizationRepository } from './persistence/drizzle-authorization.repository.ts';
import { createSuppressionGate } from './persistence/drizzle-suppression.gate.ts';
import { AuthorizeNotification } from './use-cases/authorize-notification/authorize-notification.ts';

/** مفتاح بصمة الهاتف: مطلوب لبصمة مستقرة عبر إعادة التشغيل؛ من غيره بيتسجّل الواتساب المقفول بمفتاح مؤقت (ADR-0018 §11). */
export interface PhoneHashConfiguration {
  readonly hashKey: string;
  readonly hashKeyId: string;
}

/**
 * يقرا مفتاح بصمة الهاتف من البيئة من غير ما يرمي: غير صالح أو ناقص معناه null، ومسار تنبيهات الفريق بيسجّل الفشل ظاهراً بمفتاح مؤقت.
 *
 * @param env بيئة العملية
 * @returns المفتاح ومعرّفه، أو null
 */
export function readPhoneHashConfiguration(env: NodeJS.ProcessEnv): PhoneHashConfiguration | null {
  const hashKey = env['NOTIFICATION_PHONE_HASH_KEY'] ?? '';
  const hashKeyId = env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '';
  try {
    createPhoneIdentity(hashKey, hashKeyId);
  } catch {
    return null;
  }
  return { hashKey, hashKeyId };
}

/**
 * مسار واتساب المقفول لتنبيهات الفريق في الإنتاج: يسجّل دائماً محاولة FAILED / CONFIG_INVALID وحدث NotificationFailed
 * من غير حفظ الهاتف. لو مفتاح بصمة الهاتف مش مضبوط يستخدم مفتاحاً مؤقتاً عشوائياً في الذاكرة (hash_key_id = unconfigured)
 * بدل ما يسقط التنبيه في صمت (ADR-0018 §11).
 *
 * @param options الساعة ومولّد المعرفات ومفتاح بصمة الهاتف إن وُجد
 * @returns تبعيات المسار المقفول (لا يرجع undefined أبداً)
 */
export function productionClosedTeamAlertWhatsapp(options: {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly phoneConfiguration?: PhoneHashConfiguration | null | undefined;
}) {
  const phone = options.phoneConfiguration;
  const configured = phone !== undefined && phone !== null;
  const identity = configured
    ? createPhoneIdentity(phone.hashKey, phone.hashKeyId)
    : createPhoneIdentity(randomBytes(32).toString('hex'), 'unconfigured');
  return {
    authorize: (tx: Tx) =>
      new AuthorizeNotification(
        createAuthorizationRepository(tx),
        configured ? createSuppressionGate(tx) : { isSuppressed: async () => false },
        options.clock,
        options.ids,
      ),
    identity,
  };
}
