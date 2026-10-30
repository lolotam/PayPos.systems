import { createHash, createHmac } from 'node:crypto';

export interface RatingTokenKeyRing {
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, Uint8Array>;
}

export type RatingTokenConfiguration =
  | { readonly state: 'DISABLED'; readonly reason: 'NOT_CONFIGURED' }
  | { readonly state: 'UNAVAILABLE'; readonly reason: 'CONFIGURATION_INVALID' }
  | { readonly state: 'READY'; readonly ring: RatingTokenKeyRing; readonly fingerprint: string };

/**
 * يقرأ حلقة مفاتيح الاشتقاق ويفشل مغلقاً عند أي إعداد ناقص أو غير canonical.
 *
 * @param env متغيرات بيئة الـ worker التي تحمل المفاتيح وإصداراتها
 * @returns حالة القدرة، وحلقة مفاتيح مملوكة للقارئ وبصمتها عند الجاهزية
 */
export function readRatingTokenConfiguration(env: NodeJS.ProcessEnv): RatingTokenConfiguration {
  const currentKeyText = env['RATING_TOKEN_DERIVATION_KEY'] ?? '';
  const currentVersionText = env['RATING_TOKEN_DERIVATION_KEY_VERSION'] ?? '';
  const retiredText = env['RATING_TOKEN_DERIVATION_RETIRED_KEYS'] ?? '';
  if (currentKeyText === '' && currentVersionText === '' && retiredText === '')
    return { state: 'DISABLED', reason: 'NOT_CONFIGURED' };
  try {
    const currentVersion = parseVersion(currentVersionText);
    const retired: unknown = JSON.parse(retiredText || '{}');
    if (
      retired === null ||
      typeof retired !== 'object' ||
      Array.isArray(retired) ||
      hasDuplicatePropertyNames(retiredText, retired)
    )
      throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
    const keys = new Map<number, Uint8Array>();
    const keyIdentities = new Set<string>();
    const ratingKeyTexts = [currentKeyText];
    const addKey = (version: number, text: string): void => {
      if (keys.has(version)) throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
      const key = decodeKey(text);
      const identity = key.toString('hex');
      if (keyIdentities.has(identity)) throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
      keyIdentities.add(identity);
      keys.set(version, key);
    };
    addKey(currentVersion, currentKeyText);
    for (const [version, key] of Object.entries(retired)) {
      if (typeof key !== 'string') throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
      ratingKeyTexts.push(key);
      addKey(parseVersion(version), key);
    }
    const ring = { currentVersion, keys };
    if (hasReusedRatingKey(env, ratingKeyTexts))
      throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
    return { state: 'READY', ring, fingerprint: configurationFingerprint(ring) };
  } catch {
    return { state: 'UNAVAILABLE', reason: 'CONFIGURATION_INVALID' };
  }
}

function hasDuplicatePropertyNames(raw: string, parsed: object): boolean {
  const propertyNames = raw.match(/"(?:[^"\\]|\\.)*"\s*:/g) ?? [];
  return propertyNames.length !== Object.keys(parsed).length;
}

function hasReusedRatingKey(env: NodeJS.ProcessEnv, ratingKeyTexts: readonly string[]): boolean {
  const otherFeatureKeys = [
    env['STAFF_OTP_DERIVATION_KEY'],
    env['STAFF_OTP_VERIFICATION_KEY'],
    env['NOTIFICATION_PHONE_HASH_KEY'],
    env['NOTIFICATION_MESSAGE_ID_HASH_KEY'],
  ];
  return ratingKeyTexts.some((ratingKey) =>
    otherFeatureKeys.some(
      (otherKey) => otherKey !== undefined && otherKey !== '' && otherKey === ratingKey,
    ),
  );
}

function parseVersion(text: string): number {
  if (!/^[1-9]\d{0,4}$/.test(text)) throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
  const version = Number(text);
  if (version > 32767) throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
  return version;
}

function decodeKey(text: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length < 32 || decoded.toString('base64') !== text)
    throw new Error('RATING_TOKEN_CONFIGURATION_INVALID');
  return decoded;
}

function configurationFingerprint(ring: RatingTokenKeyRing): string {
  const lines = [...ring.keys.entries()]
    .sort(([left], [right]) => left - right)
    .map(
      ([version, key]) =>
        `${version}:${createHmac('sha256', key)
          .update('pospay:rating-token:fingerprint:v1')
          .digest('hex')}`,
    );
  const payload = [`current:${ring.currentVersion}`, ...lines].join('\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 16);
}
