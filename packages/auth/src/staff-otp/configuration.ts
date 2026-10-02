import { createHash } from 'node:crypto';
import { createOtpCrypto, type OtpKeys } from './crypto.ts';

export type OtpConfiguration =
  | { readonly state: 'DISABLED' | 'UNAVAILABLE'; readonly reason: string }
  | {
      readonly state: 'READY';
      readonly keys: OtpKeys;
      readonly fingerprint: string;
      readonly templates: Readonly<Record<'ar' | 'en', string>>;
      readonly posOrigin: string;
    };

export function readStaffOtpConfiguration(
  env: NodeJS.ProcessEnv,
  role: 'api' | 'worker',
): OtpConfiguration {
  if (
    env['STAFF_OTP_ENABLED'] === undefined ||
    env['STAFF_OTP_ENABLED'] === '' ||
    env['STAFF_OTP_ENABLED'] === 'false'
  )
    return { state: 'DISABLED', reason: 'NOT_ACTIVATED' };
  try {
    assertLiveConfiguration(env, role);
    const posOrigin = env['STAFF_OTP_POS_ORIGIN'] ?? '';
    if (
      new URL(posOrigin).origin !== posOrigin ||
      !(env['AUTH_TRUSTED_ORIGINS'] ?? '')
        .split(',')
        .map((x) => x.trim())
        .includes(posOrigin)
    )
      throw new Error('OTP_ORIGIN_INVALID');
    const templates = {
      ar: env['STAFF_OTP_TEMPLATE_AR'] ?? '',
      en: env['STAFF_OTP_TEMPLATE_EN'] ?? '',
    };
    if (Object.values(templates).some((name) => !/^[a-z][a-z0-9_]{0,511}$/.test(name)))
      throw new Error('OTP_TEMPLATE_INVALID');
    const keys: OtpKeys = {
      derivationId: env['STAFF_OTP_DERIVATION_KEY_ID'] ?? '',
      verificationId: env['STAFF_OTP_VERIFICATION_KEY_ID'] ?? '',
      derivation: keyRing(env, 'DERIVATION'),
      verification: keyRing(env, 'VERIFICATION'),
    };
    createOtpCrypto(keys);
    const fingerprint = configurationFingerprint(env, posOrigin, templates, keys);
    return { state: 'READY', keys, templates, posOrigin, fingerprint };
  } catch {
    return { state: 'UNAVAILABLE', reason: 'LIVE_CONFIGURATION_INCOMPLETE' };
  }
}

function keyRing(env: NodeJS.ProcessEnv, family: string): ReadonlyMap<string, Uint8Array> {
  const id = env[`STAFF_OTP_${family}_KEY_ID`] ?? '';
  const value = env[`STAFF_OTP_${family}_KEY`] ?? '';
  const retired: unknown = JSON.parse(env[`STAFF_OTP_${family}_RETIRED_KEYS`] || '{}');
  if (retired === null || typeof retired !== 'object' || Array.isArray(retired))
    throw new Error('OTP_KEY_CONFIG_INVALID');
  const entries = [[id, value], ...Object.entries(retired)] as [string, unknown][];
  if (new Set(entries.map(([keyId]) => keyId)).size !== entries.length)
    throw new Error('OTP_KEY_CONFIG_INVALID');
  return new Map(
    entries.map(([keyId, key]) => {
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId) ||
        typeof key !== 'string' ||
        !/^[a-zA-Z0-9+/]+={0,2}$/.test(key)
      )
        throw new Error('OTP_KEY_CONFIG_INVALID');
      const decoded = Buffer.from(key, 'base64');
      if (decoded.length < 32 || decoded.toString('base64') !== key)
        throw new Error('OTP_KEY_CONFIG_INVALID');
      return [keyId, decoded];
    }),
  );
}

function assertLiveConfiguration(env: NodeJS.ProcessEnv, role: 'api' | 'worker'): void {
  if (
    env['STAFF_OTP_ENABLED'] !== 'true' ||
    env['NOTIFICATIONS_MODE'] !== 'live' ||
    env['WHATSAPP_STOP_SUBSCRIPTION_CONFIRMED'] !== 'true' ||
    env['STAFF_OTP_TEMPLATES_APPROVED'] !== 'true' ||
    env['WHATSAPP_GRAPH_API_VERSION'] !== 'v23.0' ||
    !env['AUTH_DATABASE_URL'] ||
    !env['REDIS_URL'] ||
    !env['WHATSAPP_APP_SECRET'] ||
    !env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] ||
    !env['WHATSAPP_WABA_ID'] ||
    !env['WHATSAPP_PHONE_NUMBER_ID'] ||
    !env['PLATFORM_NOTIFICATIONS_DATABASE_URL'] ||
    (env['NOTIFICATION_PHONE_HASH_KEY']?.length ?? 0) < 32 ||
    !env['NOTIFICATION_PHONE_HASH_KEY_ID'] ||
    (env['NOTIFICATION_MESSAGE_ID_HASH_KEY']?.length ?? 0) < 32 ||
    (role === 'worker' && !env['WHATSAPP_ACCESS_TOKEN'])
  )
    throw new Error('OTP_LIVE_GATE_CLOSED');
  for (const locale of ['AR', 'EN']) {
    const components: unknown = JSON.parse(env[`STAFF_OTP_COMPONENTS_${locale}`] ?? '');
    if (
      !Array.isArray(components) ||
      components.length !== 2 ||
      components[0]?.type !== 'body' ||
      components[1]?.type !== 'button' ||
      components[1]?.sub_type !== 'url' ||
      components[1]?.index !== '0' ||
      Object.keys(components[0]).length !== 1 ||
      Object.keys(components[1]).length !== 3
    )
      throw new Error('OTP_TEMPLATE_INVALID');
  }
}

function configurationFingerprint(
  env: NodeJS.ProcessEnv,
  posOrigin: string,
  templates: Readonly<Record<'ar' | 'en', string>>,
  keys: OtpKeys,
): string {
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        posOrigin,
        templates,
        componentsAr: env['STAFF_OTP_COMPONENTS_AR'],
        componentsEn: env['STAFF_OTP_COMPONENTS_EN'],
        derivation: [...keys.derivation].map(([id, k]) => [id, Buffer.from(k).toString('base64')]),
        verification: [...keys.verification].map(([id, k]) => [
          id,
          Buffer.from(k).toString('base64'),
        ]),
        phoneKey: env['NOTIFICATION_PHONE_HASH_KEY'],
        phoneKeyId: env['NOTIFICATION_PHONE_HASH_KEY_ID'],
        messageKey: env['NOTIFICATION_MESSAGE_ID_HASH_KEY'],
      }),
    )
    .digest('hex');

  return fingerprint;
}
