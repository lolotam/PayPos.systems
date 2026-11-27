import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createStaffOtpExecution, type EmailOtpConfiguration } from '@pospay/auth';
import {
  createEmailIdentity,
  createPhoneIdentity,
  createProviderMessageDigest,
  phoneLockKey,
  type Channel,
  type EmailRequest,
  type ChannelResult,
} from '@pospay/notifications';

import { otpFixture } from '../../../../../../packages/db/test/otp-fixtures.ts';
import { createOtpCrypto } from '../../../../../../packages/auth/src/staff-otp/crypto.ts';
import { createEmailOtpChannel } from '../persistence/otp-email-channel.adapter.ts';
import { SendStaffOtp } from '../use-cases/send-staff-otp/send-staff-otp.ts';
import type { OtpChallenge } from '../../../../../../packages/auth/src/staff-otp/types.ts';

const keys = {
  derivationId: 'synthetic-d',
  verificationId: 'synthetic-v',
  derivation: new Map([['synthetic-d', Buffer.alloc(32, 17)]]),
  verification: new Map([['synthetic-v', Buffer.alloc(32, 29)]]),
};
const emailIdentity = createEmailIdentity('synthetic-email'.repeat(6), 'synthetic-e');
const phoneIdentity = createPhoneIdentity('synthetic'.repeat(8), 'synthetic-h');
const digest = createProviderMessageDigest('synthetic'.repeat(8), 'synthetic-h');
const ready = { available: () => true, ready: async () => true };
const emailConfiguration: EmailOtpConfiguration = {
  state: 'READY',
  fingerprint: 'synthetic-email',
  keys,
};

let f: Awaited<ReturnType<typeof otpFixture>>;
let auth: ReturnType<typeof createStaffOtpExecution>;

beforeAll(async () => {
  f = await otpFixture();
  auth = createStaffOtpExecution({
    databaseUrl: f.test.authUrl,
    // الواتساب مقفول بالكامل: الإيميل لازم يشتغل من غيره (BR-004).
    configuration: () => ({ state: 'DISABLED', reason: 'SYNTHETIC' }) as never,
    emailConfiguration: () => emailConfiguration,
    capability: { ready: async () => false },
    emailCapability: ready,
    strategies: {
      identify: phoneIdentity.identify,
      phoneLockKey,
      identifyEmail: emailIdentity.identify,
    },
  });
  await auth.readiness();
});

afterAll(async () => {
  await auth?.close();
  await f?.close();
});

interface Sent {
  request: EmailRequest;
}
let sent: Sent[];
let result: ChannelResult;

const channel: Channel<EmailRequest> = {
  send: async (request) => {
    sent.push({ request });
    return result;
  },
};

beforeEach(() => {
  sent = [];
  result = { kind: 'accepted', providerMessageId: 'synthetic-provider-id' };
});

/** اعتماد استرجاع حقيقي مُجهَّز ومُفرَج عنه، بالكود المشتق منه نفسه. */
async function released() {
  const userId = randomUUID();
  const email = `owner.${userId}@otp.invalid`;
  await f.owner`INSERT INTO "user"(id,name,email,email_verified) VALUES(${userId},'synthetic',${email},true)`;
  const createdAt = new Date();
  const challenge: OtpChallenge = {
    id: randomUUID(),
    recipientHash: Buffer.from(emailIdentity.identify(email).hash),
    hashKeyId: 'synthetic-e',
    userId,
    deviceContext: { purpose: 'PASSWORD_RESET' },
    codeMac: null,
    derivationKeyId: 'synthetic-d',
    verificationKeyId: 'synthetic-v',
    status: 'ACTIVE',
    failedAttempts: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 600_000),
  };
  const crypto = createOtpCrypto(keys);
  const attemptId = randomUUID();
  const preparationDeadline = new Date(createdAt.getTime() + 200);
  expect(
    await f.db.prepareEmailResetChallenge({
      challengeId: challenge.id,
      attemptId,
      recipientHash: challenge.recipientHash,
      hashKeyId: 'synthetic-e',
      userId,
      locale: 'en',
      createdAt,
      expiresAt: challenge.expiresAt,
      preparationDeadline,
      derivationKeyId: 'synthetic-d',
      verificationKeyId: 'synthetic-v',
      eligible: true,
      auditId: randomUUID(),
      materializeMac: () => crypto.mac(challenge, crypto.derive(challenge)),
    }),
  ).toBe('PREPARED');
  expect(await f.db.release(challenge.id, attemptId, preparationDeadline, async () => true)).toBe(
    true,
  );
  return { challenge, attemptId, email, code: crypto.derive(challenge) };
}

function worker() {
  const now = () => new Date();
  return new SendStaffOtp(
    auth,
    ready,
    { reserve: async () => true },
    [createEmailOtpChannel(channel, ready, (id) => digest(id), now)],
    { now },
    { newId: randomUUID },
    { pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
  );
}

it('sends the recovery email once through the mocked Resend channel with the auth correlation', async () => {
  const p = await released();
  await worker().execute(p.challenge.id, p.attemptId);
  expect(sent).toHaveLength(1);
  const request = sent[0]?.request;
  expect(request).toBeDefined();
  if (request === undefined) return;
  expect(request).toMatchObject({
    email: p.email,
    locale: 'en',
    templateKey: 'password_reset_otp',
    templateRevision: 1,
    safeParameters: [p.code],
    attemptId: p.attemptId,
    authChallengeId: p.challenge.id,
  });
  expect(request.companyId).toBeUndefined();
  expect(request.executionId).toMatch(/^[a-f0-9-]{36}$/);
  const attempt = await f.owner`SELECT status, failure_code, provider_message_digest, execution_id
    FROM auth_notification_attempts WHERE id=${p.attemptId}`;
  expect(attempt[0]).toMatchObject({ status: 'SENT', failure_code: 'PROVIDER_ACCEPTED' });
  expect(Buffer.from(attempt[0]?.['provider_message_digest'])).toEqual(
    digest('synthetic-provider-id'),
  );
  // الاعتماد بيرسل مرة واحدة: إعادة نفس المهمة ما تبعتش تاني.
  await worker().execute(p.challenge.id, p.attemptId);
  expect(sent).toHaveLength(1);
});

it('never writes the destination or the code into the ledger row', async () => {
  const p = await released();
  await worker().execute(p.challenge.id, p.attemptId);
  const rows = JSON.stringify(
    await f.owner`SELECT to_jsonb(a) AS attempt, to_jsonb(c) AS challenge
      FROM auth_notification_attempts a JOIN auth_otp_challenges c ON c.id=a.challenge_id WHERE a.id=${p.attemptId}`,
  );
  expect(rows).not.toContain(p.email);
  expect(rows).not.toContain(p.code);
});

it('records a provider rejection and an unknown outcome without a second send', async () => {
  const rejected = await released();
  result = { kind: 'rejected', code: 'PROVIDER_4XX', outcomeKnown: true };
  await worker().execute(rejected.challenge.id, rejected.attemptId);
  expect(
    (
      await f.owner`SELECT status, failure_code, outcome_known FROM auth_notification_attempts WHERE id=${rejected.attemptId}`
    )[0],
  ).toMatchObject({ status: 'FAILED', failure_code: 'PROVIDER_REJECTED', outcome_known: true });
  const unknown = await released();
  result = { kind: 'unknown', code: 'NETWORK_UNKNOWN', outcomeKnown: false };
  await worker().execute(unknown.challenge.id, unknown.attemptId);
  expect(
    (
      await f.owner`SELECT status, failure_code, outcome_known FROM auth_notification_attempts WHERE id=${unknown.attemptId}`
    )[0],
  ).toMatchObject({ status: 'FAILED', failure_code: 'PROVIDER_UNKNOWN', outcome_known: false });
  expect(sent).toHaveLength(2);
});

it('refuses to send when the user turned into a staff account after the request', async () => {
  const p = await released();
  await f.owner`UPDATE "user" SET staff_access_operation_id=${randomUUID()}, staff_access_company_id=${randomUUID()}
    WHERE id=${p.challenge.userId}`;
  await worker().execute(p.challenge.id, p.attemptId);
  expect(sent).toHaveLength(0);
  expect(
    (await f.owner`SELECT status FROM auth_notification_attempts WHERE id=${p.attemptId}`)[0],
  ).toMatchObject({ status: 'FAILED' });
});

it('refuses to send when the account email changed after the request', async () => {
  const p = await released();
  await f.owner`UPDATE "user" SET email=${`moved.${randomBytes(4).toString('hex')}@otp.invalid`} WHERE id=${p.challenge.userId}`;
  await worker().execute(p.challenge.id, p.attemptId);
  expect(sent).toHaveLength(0);
});

it('does not send when the email capability is not ready', async () => {
  const p = await released();
  const now = () => new Date();
  const notReady = { available: () => false, ready: async () => false };
  const closed = new SendStaffOtp(
    auth,
    notReady,
    { reserve: async () => true },
    [createEmailOtpChannel(channel, notReady, vi.fn(), now)],
    { now },
    { newId: randomUUID },
    { pause: async () => undefined },
  );
  await closed.execute(p.challenge.id, p.attemptId);
  expect(sent).toHaveLength(0);
});
