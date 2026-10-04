import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OtpChallenge } from './types.ts';

export interface OtpKeys {
  readonly derivationId: string;
  readonly verificationId: string;
  readonly derivation: ReadonlyMap<string, Uint8Array>;
  readonly verification: ReadonlyMap<string, Uint8Array>;
}

function encode(parts: readonly string[]): Buffer {
  return Buffer.concat(
    parts.map((part) => {
      const value = Buffer.from(part, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32BE(value.length);
      return Buffer.concat([length, value]);
    }),
  );
}

export function challengeContext(
  challenge: Pick<OtpChallenge, 'id' | 'recipientHash' | 'deviceContext'>,
): Buffer {
  const d = challenge.deviceContext;
  if ('purpose' in d)
    return encode([
      'pospay:personal-otp:context:v1',
      challenge.id,
      Buffer.from(challenge.recipientHash).toString('hex'),
      d.companyId,
      d.businessId,
    ]);
  return encode([
    'pospay:staff-otp:context:v1',
    challenge.id,
    Buffer.from(challenge.recipientHash).toString('hex'),
    d.companyId,
    d.businessId,
    d.branchId,
    d.deviceId,
  ]);
}

export function unbiasedDecimal(bytes: Uint8Array): string | null {
  const buffer = Buffer.from(bytes);
  // آخر 967296 قيمة غير مقبولة حتى يتوزع كل كود على العدد نفسه من القيم.
  for (let offset = 0; offset + 4 <= buffer.length; offset += 4) {
    const value = buffer.readUInt32BE(offset);
    if (value < 4_294_000_000) return String(value % 1_000_000).padStart(6, '0');
  }
  return null;
}

export function createOtpCrypto(keys: OtpKeys) {
  validateKeys(keys);
  const derive = (challenge: OtpChallenge): string => {
    const key = keys.derivation.get(challenge.derivationKeyId ?? '');
    if (key === undefined) throw new Error('OTP_KEY_UNAVAILABLE');
    const context = challengeContext(challenge);
    for (let counter = 0; counter < 1024; counter++) {
      const expanded = createHmac('sha256', key)
        .update(encode(['pospay:staff-otp:derive:v1', String(counter)]))
        .update(context)
        .digest();
      const result = unbiasedDecimal(expanded);
      if (result !== null) return result;
    }
    throw new Error('OTP_DERIVATION_FAILED');
  };
  const mac = (challenge: OtpChallenge, code: string): Buffer => {
    const key = keys.verification.get(challenge.verificationKeyId ?? '');
    if (key === undefined) throw new Error('OTP_KEY_UNAVAILABLE');
    return createHmac('sha256', key)
      .update(encode(['pospay:staff-otp:verify:v1']))
      .update(challengeContext(challenge))
      .update(encode([code]))
      .digest();
  };
  const dummy = (code: string): void => {
    const key = keys.verification.get(keys.verificationId);
    if (key === undefined) throw new Error('OTP_KEY_UNAVAILABLE');
    const computed = createHmac('sha256', key)
      .update(encode(['pospay:staff-otp:dummy:v1', code]))
      .digest();
    timingSafeEqual(computed, Buffer.alloc(32));
  };
  return {
    derive,
    mac,
    dummy,
    compare(challenge: OtpChallenge, code: string): boolean {
      const computed = mac(challenge, code);
      const expected = challenge.codeMac;
      return (
        timingSafeEqual(
          computed,
          expected?.length === 32 ? Buffer.from(expected) : Buffer.alloc(32),
        ) &&
        expected?.length === 32 &&
        /^\d{6}$/.test(code)
      );
    },
  };
}

function validateKeys(keys: OtpKeys): void {
  const all = [...keys.derivation.values(), ...keys.verification.values()];
  if (
    !keys.derivation.has(keys.derivationId) ||
    !keys.verification.has(keys.verificationId) ||
    all.some((key) => key.length < 32)
  )
    throw new Error('OTP_KEY_CONFIG_INVALID');
  const identities = all.map((key) => Buffer.from(key).toString('hex'));
  if (new Set(identities).size !== identities.length) throw new Error('OTP_KEYS_NOT_INDEPENDENT');
}

export type OtpCrypto = ReturnType<typeof createOtpCrypto>;
