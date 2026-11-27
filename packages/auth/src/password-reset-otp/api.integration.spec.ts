import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailIdentity } from '../../../notifications/src/email-identity.ts';
import { phoneLockKey } from '../../../notifications/src/phone-identity.ts';
import { otpFixture } from '../../../db/test/otp-fixtures.ts';
import { createPasswordResetOtpApi, type PasswordResetOtpApi } from './api.ts';
import { createOtpCrypto } from '../staff-otp/crypto.ts';
import type { OtpChallenge } from '../staff-otp/types.ts';

// الخدمة على قاعدة حقيقية: الـ constraints والأقفال والـ audit بتتجرب، وRedis والطابور وكلمة المرور مزيّفة.
const keys = {
  derivationId: 'synthetic-d',
  verificationId: 'synthetic-v',
  derivation: new Map([['synthetic-d', Buffer.alloc(32, 17)]]),
  verification: new Map([['synthetic-v', Buffer.alloc(32, 29)]]),
};
const identity = createEmailIdentity('synthetic-email'.repeat(6), 'synthetic-e');
const IP = '192.0.2.1';

let f: Awaited<ReturnType<typeof otpFixture>>;
let api: PasswordResetOtpApi;
const enqueue = vi.fn(async () => undefined);
const hash = vi.fn(async (password: string) => `hashed:${password}`);

const buildApi = (hasher: { hash(password: string): Promise<string> }): PasswordResetOtpApi =>
  createPasswordResetOtpApi({
    databaseUrl: f.test.authUrl,
    configuration: () => ({ state: 'READY', keys, fingerprint: 'synthetic' }),
    capability: { ready: async () => true },
    rates: { request: async () => 0, verify: async () => 0 },
    sender: { enqueue },
    strategies: {
      identify: () => ({ hash: new Uint8Array(32), hashKeyId: '', valid: false }),
      phoneLockKey,
      identifyEmail: identity.identify,
    },
    ids: { newId: randomUUID },
    clock: {
      now: () => new Date(),
      waitUntil: (deadline) =>
        new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline.getTime() - Date.now()))),
    },
    hasher,
  });

beforeAll(async () => {
  f = await otpFixture();
  api = buildApi({ hash });
  await api.readiness();
});

afterAll(async () => {
  await api?.close();
  await f?.close();
});

beforeEach(() => {
  enqueue.mockClear();
  hash.mockClear();
});

async function seedUser(staff = false) {
  const id = randomUUID();
  const email = `owner.${id}@otp.invalid`;
  await f.owner`INSERT INTO "user"(id,name,email,email_verified,staff_access_operation_id,staff_access_company_id)
    VALUES(${id},'synthetic',${email},true,${staff ? randomUUID() : null},${staff ? randomUUID() : null})`;
  return { id, email };
}

/** الكود الصحيح بيتشتق من صف الاعتماد نفسه زي ما العامل بيعمل. */
async function codeOf(challengeId: string): Promise<string> {
  const [row] =
    await f.owner`SELECT id, recipient_hash, hash_key_id, user_id, device_context, derivation_key_id,
    verification_key_id, status, failed_attempts, created_at, expires_at FROM auth_otp_challenges WHERE id=${challengeId}`;
  const challenge = {
    id: row?.['id'],
    recipientHash: row?.['recipient_hash'],
    hashKeyId: row?.['hash_key_id'],
    userId: row?.['user_id'],
    deviceContext: row?.['device_context'],
    codeMac: null,
    derivationKeyId: row?.['derivation_key_id'],
    verificationKeyId: row?.['verification_key_id'],
    status: row?.['status'],
    failedAttempts: row?.['failed_attempts'],
    createdAt: row?.['created_at'],
    expiresAt: row?.['expires_at'],
  } as OtpChallenge;
  return createOtpCrypto(keys).derive(challenge);
}

const request = (email: string) => api.request({ email, locale: 'en', ip: IP });
const reset = (challengeId: string, code: string, newPassword = 'a-new-password') =>
  api.reset({ challengeId, code, newPassword, ip: IP });

describe('requesting a code on a real database', () => {
  it('prepares the challenge for an owner, hands it to the queue once, and releases it', async () => {
    const owner = await seedUser();
    const result = await request(owner.email.toUpperCase());
    expect(result.kind).toBe('accepted');
    if (result.kind !== 'accepted') return;
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [attempt] = await f.owner`SELECT status, channel, template_key,
      extract(epoch FROM send_deadline - created_at)::int AS lifetime
      FROM auth_notification_attempts WHERE challenge_id=${result.challengeId}`;
    expect(attempt).toEqual({
      status: 'PENDING',
      channel: 'EMAIL',
      template_key: 'password_reset_otp',
      lifetime: 600,
    });
  });

  it('answers a staff account, an unknown email and a suppressed email the same way, with no queue job', async () => {
    const staff = await seedUser(true);
    const suppressed = await seedUser();
    await f.owner`INSERT INTO platform_email_suppressions(recipient_hash,hash_key_id,source,first_suppressed_at,last_suppressed_at)
      VALUES(${Buffer.from(identity.identify(suppressed.email).hash)},'synthetic-e','BOUNCE',clock_timestamp(),clock_timestamp())`;
    const results = [
      await request(staff.email),
      await request(`nobody.${randomUUID()}@otp.invalid`),
      await request(suppressed.email),
      await request(`staff-${randomUUID()}@staff.pospay.invalid`),
    ];
    for (const result of results) expect(result.kind).toBe('accepted');
    expect(enqueue).not.toHaveBeenCalled();
    expect(
      await f.owner`SELECT 1 FROM auth_notification_attempts WHERE status IN ('PENDING','SENDING')
        AND user_id=${staff.id}`,
    ).toEqual([]);
  });
});

async function requested() {
  const owner = await seedUser();
  const result = await request(owner.email);
  if (result.kind !== 'accepted') throw new Error('TEST_REQUEST_REFUSED');
  return { owner, challengeId: result.challengeId, code: await codeOf(result.challengeId) };
}

describe('resetting the password on a real database', () => {
  it('changes the password once, ends every session, keeps two_factor and issues no session', async () => {
    const { owner, challengeId, code } = await requested();
    await f.owner`INSERT INTO session(id,expires_at,token,user_id) VALUES(${randomUUID()},now()+interval '1 day',${`t-${owner.id}`},${owner.id})`;
    await f.owner`INSERT INTO two_factor(id,secret,backup_codes,user_id) VALUES(${randomUUID()},'synthetic','synthetic',${owner.id})`;
    const results = await Promise.all([
      reset(challengeId, code),
      reset(challengeId, code),
      reset(challengeId, code),
    ]);
    expect(results.filter((r) => r.kind === 'reset')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'invalid')).toHaveLength(2);
    expect(hash).toHaveBeenCalledTimes(1);
    expect(await f.owner`SELECT password FROM account WHERE user_id=${owner.id}`).toEqual([
      { password: 'hashed:a-new-password' },
    ]);
    expect(await f.owner`SELECT id FROM session WHERE user_id=${owner.id}`).toEqual([]);
    expect(await f.owner`SELECT id FROM two_factor WHERE user_id=${owner.id}`).toHaveLength(1);
    expect((await reset(challengeId, code)).kind).toBe('invalid');
  });

  it('exhausts the challenge on the fifth wrong code, so even the right code no longer works', async () => {
    const { owner, challengeId, code } = await requested();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect((await reset(challengeId, wrong)).kind).toBe('invalid');
    expect((await reset(challengeId, code)).kind).toBe('invalid');
    expect(hash).not.toHaveBeenCalled();
    expect(
      (await f.owner`SELECT status, code_mac FROM auth_otp_challenges WHERE id=${challengeId}`)[0],
    ).toEqual({ status: 'EXHAUSTED', code_mac: null });
    expect(await f.owner`SELECT 1 FROM account WHERE user_id=${owner.id}`).toEqual([]);
  });

  it('makes a newer request supersede the older code', async () => {
    const owner = await seedUser();
    const first = await request(owner.email);
    if (first.kind !== 'accepted') throw new Error('TEST_REQUEST_REFUSED');
    const firstCode = await codeOf(first.challengeId);
    const second = await request(owner.email);
    if (second.kind !== 'accepted') throw new Error('TEST_REQUEST_REFUSED');
    expect((await reset(first.challengeId, firstCode)).kind).toBe('invalid');
    expect((await reset(second.challengeId, await codeOf(second.challengeId))).kind).toBe('reset');
  });

  it('refuses a user converted to a staff account after the code was issued', async () => {
    const { owner, challengeId, code } = await requested();
    await f.owner`UPDATE "user" SET staff_access_operation_id=${randomUUID()}, staff_access_company_id=${randomUUID()} WHERE id=${owner.id}`;
    expect((await reset(challengeId, code)).kind).toBe('invalid');
    expect(await f.owner`SELECT 1 FROM account WHERE user_id=${owner.id}`).toEqual([]);
  });
});

describe('two service instances sharing one database', () => {
  it('lets the database row lock, not the in-process gate, pick the single winner of two instances', async () => {
    const { owner, challengeId, code } = await requested();
    // الحارس داخل العملية مش بيتشارك بين الخدمتين، والتجزئة البطيئة بتخلّي الاتنين يعدّوا الفحص قبل الاستهلاك.
    let hashing = 0;
    const slow = {
      hash: async (password: string) => {
        hashing += 1;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return `hashed:${password}`;
      },
    };
    const first = buildApi(slow);
    const second = buildApi(slow);
    try {
      await Promise.all([first.readiness(), second.readiness()]);
      const results = await Promise.all([
        first.reset({ challengeId, code, newPassword: 'a-new-password', ip: IP }),
        second.reset({ challengeId, code, newPassword: 'a-new-password', ip: IP }),
      ]);
      expect(results.map((r) => r.kind).sort()).toEqual(['invalid', 'reset']);
      expect(hashing).toBe(2);
      expect(await f.owner`SELECT password FROM account WHERE user_id=${owner.id}`).toEqual([
        { password: 'hashed:a-new-password' },
      ]);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
