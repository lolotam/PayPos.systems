import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { createPlatformEmailDatabase, type PlatformEmailDatabase } from '@pospay/db';

import { otpFixture } from '../../../../../../packages/db/test/otp-fixtures.ts';
import type { EmailRetrievalPort } from '../ports/email-feedback.port.ts';
import { createAuthEmailFeedbackRepository } from '../persistence/auth-email-feedback.repository.ts';
import { createEmailFeedbackInboxRepository } from '../persistence/drizzle-email-feedback-inbox.repository.ts';
import { ReconcileEmailFeedback } from '../use-cases/reconcile-email-feedback/reconcile-email-feedback.ts';
import {
  HASH,
  KEY_ID,
  NOW,
  OTHER_ID,
  PROVIDER_ID,
  clearFeedbackRows,
  ids,
  inboxAcceptor,
  messageDigest,
} from './email-feedback-harness.ts';

// بريد الاعتماد (password_reset_otp) بيتسوّى على سجل الاعتماد على pospay_auth: الوسوم
// { auth_challenge_id, attempt_id, execution_id } بدل وسم الشركة، من غير Redis ولا قاعدة الشركات.
let f: Awaited<ReturnType<typeof otpFixture>>;
let platform: PlatformEmailDatabase;
let inbox: ReturnType<typeof createEmailFeedbackInboxRepository>;
let accept: ReturnType<typeof inboxAcceptor>;

beforeAll(async () => {
  f = await otpFixture();
  platform = createPlatformEmailDatabase({ url: f.test.notificationsUrl });
  inbox = createEmailFeedbackInboxRepository(platform);
  accept = inboxAcceptor(platform);
});

afterEach(async () => {
  await clearFeedbackRows(f.owner);
});

afterAll(async () => {
  await platform?.close();
  await f?.close();
});

interface AuthSeed {
  readonly challengeId: string;
  readonly attemptId: string;
  readonly executionId: string;
}

/** محاولة بريد اعتماد في SENDING: التحضير ثم الإذن ثم حجز التنفيذ — زي الطريق الحقيقي. */
async function sendingAttempt(recipientHash: Uint8Array = HASH): Promise<AuthSeed> {
  const userId = randomUUID();
  await f.owner`INSERT INTO "user"(id,name,email,email_verified)
    VALUES(${userId},'synthetic',${`owner.${userId}@otp.invalid`},true)`;
  const createdAt = new Date();
  const challengeId = randomUUID();
  const attemptId = randomUUID();
  const preparationDeadline = new Date(createdAt.getTime() + 200);
  const prepared = await f.db.prepareEmailResetChallenge({
    challengeId,
    attemptId,
    recipientHash,
    hashKeyId: KEY_ID,
    userId,
    locale: 'en',
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 600_000),
    preparationDeadline,
    derivationKeyId: 'synthetic-d',
    verificationKeyId: 'synthetic-v',
    eligible: true,
    auditId: randomUUID(),
    materializeMac: () => Buffer.alloc(32, 13),
  });
  if (prepared !== 'PREPARED') throw new Error(`TEST_PREPARATION_${prepared}`);
  if (!(await f.db.release(challengeId, attemptId, preparationDeadline, async () => true)))
    throw new Error('TEST_RELEASE_FAILED');
  const executionId = randomUUID();
  if (!(await f.db.claim(challengeId, attemptId, executionId)))
    throw new Error('TEST_CLAIM_FAILED');
  return { challengeId, attemptId, executionId };
}

function provider(seed: AuthSeed, overrides: Record<string, unknown> = {}): EmailRetrievalPort {
  return {
    retrieve: async () => ({
      kind: 'found' as const,
      id: PROVIDER_ID,
      tags: {
        companyId: null,
        authChallengeId: seed.challengeId,
        attemptId: seed.attemptId,
        executionId: seed.executionId,
      },
      recipientHash: HASH,
      hashKeyId: KEY_ID,
      ...overrides,
    }),
  };
}

function useCase(retrieval: EmailRetrievalPort): ReconcileEmailFeedback {
  return new ReconcileEmailFeedback(
    inbox,
    {
      // مسار الشركة ما بيتنفّذش لبريد الاعتماد: أي نداء عليه فشل صريح.
      reconcile: async () => {
        throw new Error('TENANT_PATH_MUST_NOT_RUN');
      },
    },
    createAuthEmailFeedbackRepository({ reconcileAuthAttempt: f.db.reconcileAuthAttempt }),
    retrieval,
    { now: () => NOW },
    ids,
    (providerMessageId) => messageDigest(providerMessageId),
  );
}

const inboxRow = async (id: string) =>
  (await f.owner`SELECT * FROM platform_email_feedback_inbox WHERE id = ${id}`)[0];
const attemptRow = async (id: string) =>
  (
    await f.owner`SELECT status, provider_message_digest FROM auth_notification_attempts WHERE id = ${id}`
  )[0];

it('settles a delivered event on the auth ledger without waiting for SENT, and binds the digest once', async () => {
  const seed = await sendingAttempt();
  const row = await accept('email.delivered', null);
  await useCase(provider(seed)).execute(row);
  const settled = await inboxRow(row);
  expect(settled?.['resolved_at']).not.toBeNull();
  expect(settled?.['quarantined_at']).toBeNull();
  expect(settled?.['quarantine_reason']).toBeNull();
  const attempt = await attemptRow(seed.attemptId);
  expect(attempt?.['status']).toBe('SENDING');
  expect(Buffer.from(attempt?.['provider_message_digest'] as Uint8Array)).toEqual(
    messageDigest(PROVIDER_ID),
  );
  expect(await f.owner`SELECT 1 FROM platform_email_suppressions`).toEqual([]);
});

it('suppresses a permanent bounce, audits it, and the next recovery request is silently blocked', async () => {
  const seed = await sendingAttempt();
  const row = await accept('email.bounced', 'PERMANENT');
  await useCase(provider(seed)).execute(row);
  const settled = await inboxRow(row);
  expect(settled?.['quarantine_reason']).not.toBe('TAGS_INVALID');
  expect(settled?.['resolved_at']).not.toBeNull();
  expect(
    await f.owner`SELECT source FROM platform_email_suppressions WHERE recipient_hash=${HASH}`,
  ).toEqual([{ source: 'BOUNCE' }]);
  expect(await f.owner`SELECT source FROM platform_email_audit`).toHaveLength(1);
  const userId = randomUUID();
  await f.owner`INSERT INTO "user"(id,name,email,email_verified) VALUES(${userId},'synthetic',${`owner.${userId}@otp.invalid`},true)`;
  const createdAt = new Date();
  const next = await f.db.prepareEmailResetChallenge({
    challengeId: randomUUID(),
    attemptId: randomUUID(),
    recipientHash: HASH,
    hashKeyId: KEY_ID,
    userId,
    locale: 'en',
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 600_000),
    preparationDeadline: new Date(createdAt.getTime() + 200),
    derivationKeyId: 'synthetic-d',
    verificationKeyId: 'synthetic-v',
    eligible: true,
    auditId: randomUUID(),
    materializeMac: () => Buffer.alloc(32, 13),
  });
  expect(next).toBe('SUPPRESSED');
});

it('suppresses a complaint through the same auth path', async () => {
  const seed = await sendingAttempt();
  const row = await accept('email.complained', null);
  await useCase(provider(seed)).execute(row);
  expect(
    await f.owner`SELECT source FROM platform_email_suppressions WHERE recipient_hash=${HASH}`,
  ).toHaveLength(1);
});

it('keeps a transient bounce as a resolved event with no suppression', async () => {
  const seed = await sendingAttempt();
  const row = await accept('email.bounced', 'TRANSIENT');
  await useCase(provider(seed)).execute(row);
  expect((await inboxRow(row))?.['resolved_at']).not.toBeNull();
  expect(await f.owner`SELECT 1 FROM platform_email_suppressions`).toEqual([]);
});

it.each([
  ['HASH_MISMATCH', () => ({ recipientHash: randomBytes(32) })],
  [
    'EXECUTION_MISSING',
    (seed: AuthSeed) => ({
      tags: {
        companyId: null,
        authChallengeId: seed.challengeId,
        attemptId: seed.attemptId,
        executionId: randomUUID(),
      },
    }),
  ],
  [
    'EXECUTION_MISSING',
    (seed: AuthSeed) => ({
      tags: {
        companyId: null,
        authChallengeId: randomUUID(),
        attemptId: seed.attemptId,
        executionId: seed.executionId,
      },
    }),
  ],
])('quarantines %s without writing a suppression', async (reason, override) => {
  const seed = await sendingAttempt();
  const row = await accept('email.bounced', 'PERMANENT');
  await useCase(provider(seed, override(seed))).execute(row);
  const settled = await inboxRow(row);
  expect(settled?.['quarantine_reason']).toBe(reason);
  expect(settled?.['resolved_at']).toBeNull();
  expect(await f.owner`SELECT 1 FROM platform_email_suppressions`).toEqual([]);
  expect((await attemptRow(seed.attemptId))?.['provider_message_digest']).toBeNull();
});

it('quarantines a second provider id for an attempt that already bound its digest', async () => {
  const seed = await sendingAttempt();
  const first = await accept('email.delivered', null);
  await useCase(provider(seed)).execute(first);
  const second = await accept('email.bounced', 'PERMANENT');
  await useCase(provider(seed, { id: OTHER_ID })).execute(second);
  expect((await inboxRow(second))?.['quarantine_reason']).toBe('PROVIDER_ID_CONFLICT');
  expect(await f.owner`SELECT 1 FROM platform_email_suppressions`).toEqual([]);
});

it('quarantines an attempt that already reached a terminal state it cannot accept', async () => {
  const seed = await sendingAttempt();
  await f.owner`ALTER TABLE auth_notification_attempts DISABLE TRIGGER USER`;
  try {
    await f.owner`UPDATE auth_notification_attempts SET status='EXPIRED', finished_at=clock_timestamp(),
      failure_code='CHALLENGE_INVALID', outcome_known=true WHERE id=${seed.attemptId}`;
  } finally {
    await f.owner`ALTER TABLE auth_notification_attempts ENABLE TRIGGER USER`;
  }
  const row = await accept('email.delivered', null);
  await useCase(provider(seed)).execute(row);
  expect((await inboxRow(row))?.['quarantine_reason']).toBe('STATE_INELIGIBLE');
});
