import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createStaffOtpExecution, type EmailOtpConfiguration } from '@pospay/auth';
import {
  createEmailIdentity,
  createPhoneIdentity,
  createProviderMessageDigest,
  phoneLockKey,
  type Channel,
  type EmailRequest,
} from '@pospay/notifications';

import { otpFixture } from '../../../../../../packages/db/test/otp-fixtures.ts';
import { createOtpCrypto } from '../../../../../../packages/auth/src/staff-otp/crypto.ts';
import { createEmailOtpChannel } from '../persistence/otp-email-channel.adapter.ts';
import { SendStaffOtp } from '../use-cases/send-staff-otp/send-staff-otp.ts';
import type { OtpChallenge } from '../../../../../../packages/auth/src/staff-otp/types.ts';

// تسليم كود استعادة الرقم السري للموظفة (spec 079 PR-c1): الإيميل بيتقرا من جدول الشركة بعد قفل
// معاملة الهوية، وبصمته لازم تطابق بصمة الاعتماد، وبيروح بقالبه هو، والواتساب مقفول بالكامل.
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
const device = {
  companyId: randomUUID(),
  businessId: randomUUID(),
  branchId: randomUUID(),
  deviceId: randomUUID(),
};

let f: Awaited<ReturnType<typeof otpFixture>>;
let auth: ReturnType<typeof createStaffOtpExecution>;
let tenantEmail: string | null;
let reads: { companyId: string; userId: string }[];
let sent: EmailRequest[];

const channel: Channel<EmailRequest> = {
  send: async (request) => {
    sent.push(request);
    return { kind: 'accepted', providerMessageId: 'synthetic-provider-id' };
  },
};

beforeAll(async () => {
  f = await otpFixture();
  auth = createStaffOtpExecution({
    databaseUrl: f.test.authUrl,
    configuration: () => ({ state: 'DISABLED', reason: 'SYNTHETIC' }) as never,
    emailConfiguration: () => emailConfiguration,
    capability: { ready: async () => false },
    emailCapability: ready,
    strategies: {
      identify: phoneIdentity.identify,
      phoneLockKey,
      identifyEmail: emailIdentity.identify,
    },
    readRecoveryEmail: async (companyId, userId) => {
      reads.push({ companyId, userId });
      return tenantEmail;
    },
  });
  await auth.readiness();
});

afterAll(async () => {
  await auth?.close();
  await f?.close();
});

beforeEach(() => {
  sent = [];
  reads = [];
  tenantEmail = null;
});

/** اعتماد استرجاع رقم سري حقيقي مُجهَّز ومُفرَج عنه لموظفة بإيميلها المسجّل عند الشركة. */
async function released(address: string) {
  const userId = randomUUID();
  await f.owner`INSERT INTO "user"(id,name,email,email_verified)
    VALUES(${userId},'synthetic',${`staff-${userId}@staff.pospay.invalid`},true)`;
  const createdAt = new Date();
  const challenge: OtpChallenge = {
    id: randomUUID(),
    recipientHash: Buffer.from(emailIdentity.identify(address).hash),
    hashKeyId: 'synthetic-e',
    userId,
    deviceContext: { purpose: 'STAFF_PIN_RESET', ...device, channel: 'EMAIL' },
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
      staffPin: { context: challenge.deviceContext as never, providerTemplateName: null },
    }),
  ).toBe('PREPARED');
  await f.db.release(challenge.id, attemptId, preparationDeadline, async () => true);
  return { challenge, attemptId, userId, code: crypto.derive(challenge) };
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

it('sends the PIN recovery email on its own template to the address the tenant holds', async () => {
  const address = 'sara.recovery@example.invalid';
  const p = await released(address);
  tenantEmail = address;
  await worker().execute(p.challenge.id, p.attemptId);
  expect(reads).toEqual([{ companyId: device.companyId, userId: p.userId }]);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    email: address,
    templateKey: 'staff_pin_reset_otp',
    templateRevision: 1,
    safeParameters: [p.code],
    authChallengeId: p.challenge.id,
  });
  const [attempt] =
    await f.owner`SELECT status FROM auth_notification_attempts WHERE id=${p.attemptId}`;
  expect(attempt).toMatchObject({ status: 'SENT' });
  const ledger = JSON.stringify(
    await f.owner`SELECT to_jsonb(a) AS attempt, to_jsonb(c) AS challenge
      FROM auth_notification_attempts a JOIN auth_otp_challenges c ON c.id=a.challenge_id WHERE a.id=${p.attemptId}`,
  );
  expect(ledger).not.toContain(address);
  expect(ledger).not.toContain(p.code);
});

it('sends nothing when the tenant address changed, vanished, or the employee has none', async () => {
  const moved = await released('moved.before@example.invalid');
  tenantEmail = 'moved.after@example.invalid';
  await worker().execute(moved.challenge.id, moved.attemptId);
  const gone = await released('gone@example.invalid');
  tenantEmail = null;
  await worker().execute(gone.challenge.id, gone.attemptId);
  expect(sent).toHaveLength(0);
  const rows = await f.owner`SELECT status FROM auth_notification_attempts
    WHERE id IN (${moved.attemptId}, ${gone.attemptId})`;
  expect(rows.map((row) => row['status'])).toEqual(['FAILED', 'FAILED']);
});
