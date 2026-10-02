import { present } from '../../../db/test/present.ts';
import { describe, expect, it, vi } from 'vitest';
import { timingSafeEqual, createHmac, type Hmac } from 'node:crypto';
import type * as NodeCrypto from 'node:crypto';
import { challengeContext, createOtpCrypto, unbiasedDecimal, type OtpKeys } from './crypto.ts';
import type { OtpChallenge } from './types.ts';

vi.mock('node:crypto', async (original) => {
  const real = await original<typeof NodeCrypto>();
  return {
    ...real,
    timingSafeEqual: vi.fn(real.timingSafeEqual),
    createHmac: vi.fn(real.createHmac),
  };
});

const keys: OtpKeys = {
  derivationId: 'synthetic-d',
  verificationId: 'synthetic-v',
  derivation: new Map([['synthetic-d', Buffer.alloc(32, 17)]]),
  verification: new Map([['synthetic-v', Buffer.alloc(32, 29)]]),
};
const challenge: OtpChallenge = {
  id: '00000000-0000-4000-8000-000000000001',
  recipientHash: Buffer.alloc(32, 7),
  hashKeyId: 'synthetic-h',
  userId: null,
  codeMac: null,
  status: 'ACTIVE',
  failedAttempts: 0,
  derivationKeyId: keys.derivationId,
  verificationKeyId: keys.verificationId,
  createdAt: new Date(0),
  expiresAt: new Date(300_000),
  deviceContext: { companyId: 'c', businessId: 'b', branchId: 'r', deviceId: 'd' },
};

describe('auth-owned deterministic credential', () => {
  it('uses a separate counter expansion when every uint32 in the first HMAC falls in the biased tail', () => {
    const updates: Buffer[] = [];
    const digest = (value: Buffer) => {
      const fake = {
        update: (part: Buffer) => {
          updates.push(part);
          return fake;
        },
        digest: () => value,
      };
      return fake as unknown as Hmac;
    };
    vi.mocked(createHmac)
      .mockImplementationOnce(() => digest(Buffer.alloc(32, 255)))
      .mockImplementationOnce(() => digest(Buffer.alloc(32)));
    expect(createOtpCrypto(keys).derive(challenge)).toBe(String(0).padStart(6, '0'));
    expect(updates[0]).not.toEqual(updates[2]);
    expect(updates[1]).toEqual(updates[3]);
    const boundary = Buffer.alloc(4);
    boundary.writeUInt32BE(4_294_000_000);
    expect(unbiasedDecimal(boundary)).toBeNull();
    boundary.writeUInt32BE(4_293_999_999);
    expect(unbiasedDecimal(boundary)).toBe(String(999_999));
  });
  it('matches an independently computed length-delimited HMAC reference vector', () => {
    const crypto = createOtpCrypto(keys);
    expect(crypto.mac(challenge, crypto.derive(challenge)).toString('hex')).toBe(
      '3019632ac6f1d449b9922f76e82a30f6a4af1dd1f428401b9901ae4d4410043c',
    );
    expect(
      crypto.mac({ ...challenge, id: `${challenge.id}changed` }, crypto.derive(challenge)),
    ).not.toEqual(crypto.mac(challenge, crypto.derive(challenge)));
    expect(
      challengeContext({
        ...challenge,
        deviceContext: { ...challenge.deviceContext, branchId: 'ab', deviceId: 'c' },
      }),
    ).not.toEqual(
      challengeContext({
        ...challenge,
        deviceContext: { ...challenge.deviceContext, branchId: 'a', deviceId: 'bc' },
      }),
    );
  });
});
describe('cross-instance credential agreement', () => {
  it('has stable cross-instance derivation and independent keyed verification', () => {
    const api = createOtpCrypto(keys),
      worker = createOtpCrypto(keys);
    const code = api.derive(challenge);
    expect(worker.derive(challenge)).toBe(code);
    const codeMac = api.mac(challenge, code);
    expect(worker.compare({ ...challenge, codeMac }, code)).toBe(true);
    expect(
      worker.compare({ ...challenge, codeMac }, present(unbiasedDecimal(Buffer.alloc(4)))),
    ).toBe(false);
    expect(codeMac).toHaveLength(32);
    expect(challengeContext(challenge).includes(codeMac)).toBe(false);
  });
  it('preserves leading zeroes and rejects the biased uint32 tail', () => {
    expect(unbiasedDecimal(Buffer.from([0, 0, 0, 7]))).toBe(String(7).padStart(6, '0'));
    expect(unbiasedDecimal(Buffer.from([255, 255, 255, 255]))).toBeNull();
    expect(unbiasedDecimal(Buffer.from([255, 255, 255, 255, 0, 0, 0, 7]))).toBe(
      String(7).padStart(6, '0'),
    );
  });
  it('binds the MAC to every immutable context field and exercises absent-MAC/dummy paths', () => {
    const crypto = createOtpCrypto(keys),
      code = crypto.derive(challenge);
    const signed = { ...challenge, codeMac: crypto.mac(challenge, code) };
    for (const field of ['companyId', 'businessId', 'branchId', 'deviceId'] as const)
      expect(
        crypto.compare(
          { ...signed, deviceContext: { ...signed.deviceContext, [field]: 'changed' } },
          code,
        ),
      ).toBe(false);
    expect(crypto.compare({ ...signed, recipientHash: Buffer.alloc(32, 8) }, code)).toBe(false);
    expect(crypto.compare(challenge, code)).toBe(false);
    expect(() => crypto.dummy(code)).not.toThrow();
  });
});
describe('auth-owned deterministic credential', () => {
  it('rejects equal/short/missing keys and retains explicitly configured old keys', () => {
    expect(() => createOtpCrypto({ ...keys, verification: keys.derivation })).toThrow();
    expect(() => createOtpCrypto({ ...keys, derivation: new Map() })).toThrow();
    expect(() =>
      createOtpCrypto({ ...keys, derivation: new Map([['synthetic-d', Buffer.alloc(8)]]) }),
    ).toThrow();
    const crypto = createOtpCrypto({
      ...keys,
      derivationId: 'new-d',
      derivation: new Map([...keys.derivation, ['new-d', Buffer.alloc(32, 37)]]),
    });
    expect(crypto.derive(challenge)).toBe(createOtpCrypto(keys).derive(challenge));
    expect(() => crypto.derive({ ...challenge, derivationKeyId: 'missing' })).toThrow(
      'OTP_KEY_UNAVAILABLE',
    );
  });
  it('uses the constant-time primitive on correct, wrong, absent-MAC and dummy comparisons', () => {
    const crypto = createOtpCrypto(keys),
      code = crypto.derive(challenge);
    const signed = { ...challenge, codeMac: crypto.mac(challenge, code) };
    vi.mocked(timingSafeEqual).mockClear();
    crypto.compare(signed, code);
    crypto.compare(signed, String(1).padStart(6, '0'));
    crypto.compare(challenge, code);
    crypto.dummy(code);
    expect(timingSafeEqual).toHaveBeenCalledTimes(4);
    for (const [a, b] of vi.mocked(timingSafeEqual).mock.calls) {
      expect(a.byteLength).toBe(32);
      expect(b.byteLength).toBe(32);
    }
  });
});
