import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { emailFeedbackJob } from '@pospay/notifications';

import type { Attempt } from '../domain/attempt-status.ts';
import type { EmailRetrievalPort } from '../ports/email-feedback.port.ts';
import { createEmailSuppressionGate } from '../persistence/drizzle-email-suppression.gate.ts';
import { ClearEmailFeedbackPayloads } from '../use-cases/clear-email-feedback-payloads/clear-email-feedback-payloads.ts';
import { RecoverEmailFeedback } from '../use-cases/recover-email-feedback/recover-email-feedback.ts';
import {
  clearFeedbackRows,
  emailFeedbackHarness,
  COMPANY,
  EMAIL,
  HASH,
  KEY_ID,
  NOW,
  OTHER_ID,
  PROVIDER_ID,
  type EmailFeedbackHarness,
  type Seed,
} from './email-feedback-harness.ts';

type MismatchCase = readonly [
  string,
  (seed: Seed) => Record<string, unknown>,
  { sent?: boolean; providerId?: string },
];

const attemptBase = {
  companyId: COMPANY,
  businessId: null,
  branchId: null,
  channel: 'email' as const,
  email: EMAIL,
  phone: null,
  templateKey: 'document_expiring',
  templateRevision: 1,
  providerTemplateName: null,
  safeParameters: [],
  locale: 'en' as const,
  deadline: null,
  identity: { hash: HASH, hashKeyId: KEY_ID, last3: '', valid: true },
  status: 'SENDING' as const,
  authorizedAt: NOW,
  sendingAt: NOW,
};

let harness: EmailFeedbackHarness;

beforeAll(async () => {
  harness = await emailFeedbackHarness();
});

afterEach(async () => {
  await clearFeedbackRows(harness.owner);
});

afterAll(async () => {
  await harness.close();
});

it('reconciles a delivered event into tenant evidence and resolves the row without a suppression', async () => {
  const seed = await harness.seedAttempt();
  const row = await harness.acceptInbox('email.delivered', null);
  await harness.useCase(harness.found(seed)).execute(row);
  expect(await harness.evidence()).toHaveLength(1);
  const settled = await harness.inboxRow(row);
  expect(settled?.['resolved_at']).not.toBeNull();
  expect(settled?.['quarantined_at']).toBeNull();
  expect(await harness.suppressions()).toEqual([]);
  expect(await harness.audits()).toEqual([]);
});

it('keeps the provider id bound when a late sender timeout lands after the reconciliation', async () => {
  const seed = await harness.seedAttempt();
  const row = await harness.acceptInbox('email.delivered', null);
  await harness.useCase(harness.found(seed)).execute(row);
  const attempt: Attempt = {
    ...attemptBase,
    id: seed.id,
    sourceEventId: seed.sourceEventId,
    executionId: seed.executionId,
  };
  await harness.attempts.finish(
    attempt,
    {
      status: 'FAILED',
      failureCode: 'NETWORK_UNKNOWN',
      outcomeKnown: false,
      providerMessageId: null,
    },
    '01920000-0000-7000-8000-0000000000aa',
    NOW,
  );
  const [after] = await harness.owner`
    SELECT provider_message_id, status FROM notification_attempts WHERE id = ${seed.id}`;
  expect(after?.['provider_message_id']).toBe(PROVIDER_ID);
  expect(after?.['status']).toBe('FAILED');
});

it('suppresses a permanent bounce and writes exactly one audit row after a crash and a retry', async () => {
  const seed = await harness.seedAttempt();
  const row = await harness.acceptInbox('email.bounced', 'PERMANENT');
  const crashing = {
    ...harness.inbox,
    settle: async () => {
      throw new Error('TEST_CRASH_BEFORE_PLATFORM_COMMIT');
    },
  };
  await expect(
    harness.useCase(harness.found(seed), harness.tenant, crashing).execute(row),
  ).rejects.toThrow('TEST_CRASH_BEFORE_PLATFORM_COMMIT');
  const afterCrash = await harness.inboxRow(row);
  expect(afterCrash?.['attempts']).toBe(1);
  expect(afterCrash?.['next_attempt_at']).not.toBeNull();
  expect(await harness.inbox.due(new Date(NOW.getTime() + 10 * 60_000))).toContain(row);
  expect(await harness.evidence()).toHaveLength(1);
  expect(await harness.audits()).toEqual([]);
  await harness.useCase(harness.found(seed)).execute(row);
  expect(await harness.evidence()).toHaveLength(1);
  expect(await harness.suppressions()).toHaveLength(1);
  expect(await harness.audits()).toEqual([
    { source: 'BOUNCE', reason: 'PERMANENT_BOUNCE', action: 'SUPPRESS' },
  ]);
});

it('stamps a recovery lease on pending so a hard crash without retry stays due', async () => {
  const row = await harness.acceptInbox('email.delivered', null);
  expect((await harness.inboxRow(row))?.['next_attempt_at']).toBeNull();
  const pending = await harness.inbox.pending(row);
  expect(pending?.id).toBe(row);
  const stamped = (await harness.inboxRow(row))?.['next_attempt_at'];
  expect(stamped).toBeInstanceOf(Date);
  if (!(stamped instanceof Date)) throw new Error('TEST_STAMPED_MISSING');
  expect(await harness.inbox.due(new Date(stamped.getTime() + 1_000))).toContain(row);
});

it('suppresses a complaint and a provider suppression', async () => {
  for (const [eventType, source, reason] of [
    ['email.complained', 'COMPLAINT', 'COMPLAINT'],
    ['email.suppressed', 'PROVIDER', 'PROVIDER_SUPPRESSION'],
  ] as const) {
    const seed = await harness.seedAttempt();
    const row = await harness.acceptInbox(eventType, null);
    await harness.useCase(harness.found(seed)).execute(row);
    expect(await harness.suppressions()).toContainEqual({ recipient_hash: HASH, source });
    expect(await harness.audits()).toContainEqual({ source, reason, action: 'SUPPRESS' });
  }
});

it('keeps a transient bounce, an unknown bounce, a delivery, a failure and a delay as evidence', async () => {
  let expected = 0;
  for (const [eventType, bounceClass] of [
    ['email.bounced', 'TRANSIENT'],
    ['email.bounced', null],
    ['email.delivered', null],
    ['email.failed', null],
    ['email.delivery_delayed', null],
  ] as const) {
    const seed = await harness.seedAttempt();
    const row = await harness.acceptInbox(eventType, bounceClass);
    await harness.useCase(harness.found(seed)).execute(row);
    expected += 1;
    expect(await harness.evidence()).toHaveLength(expected);
  }
  expect(await harness.suppressions()).toEqual([]);
  expect(await harness.audits()).toEqual([]);
});

it('quarantines every mismatch without writing anything in the tenant', async () => {
  const cases: readonly MismatchCase[] = [
    [
      'ATTEMPT_NOT_FOUND',
      (seed) => ({
        tags: {
          companyId: COMPANY,
          attemptId: '01920000-0000-7000-8000-0000000000b1',
          executionId: seed.executionId,
        },
      }),
      {},
    ],
    ['HASH_MISMATCH', () => ({ recipientHash: Buffer.alloc(32, 9) }), {}],
    [
      'EXECUTION_MISSING',
      (seed) => ({
        tags: {
          companyId: COMPANY,
          attemptId: seed.id,
          executionId: '01920000-0000-7000-8000-0000000000b2',
        },
      }),
      {},
    ],
    ['PROVIDER_ID_CONFLICT', () => ({ id: OTHER_ID }), { providerId: PROVIDER_ID }],
    ['STATE_INELIGIBLE', () => ({}), { sent: true }],
  ];
  for (const [reason, override, options] of cases) {
    const seed = await harness.seedAttempt(options);
    const row = await harness.acceptInbox('email.bounced', 'PERMANENT');
    await harness.useCase(harness.found(seed, override(seed))).execute(row);
    const settled = await harness.inboxRow(row);
    expect(settled?.['quarantine_reason'], reason).toBe(reason);
    expect(settled?.['resolved_at'], reason).toBeNull();
    expect(await harness.evidence(), reason).toEqual([]);
  }
  expect(await harness.suppressions()).toEqual([]);
});

it('quarantines a foreign company tag and an invalid tag without a tenant write', async () => {
  const seed = await harness.seedAttempt();
  const foreign = await harness.acceptInbox('email.bounced', 'PERMANENT');
  const crossTenant = {
    ...harness.tenant,
    reconcile: async () => ({ ok: false as const, reason: 'CROSS_TENANT' as const }),
  };
  await harness.useCase(harness.found(seed), crossTenant).execute(foreign);
  expect((await harness.inboxRow(foreign))?.['quarantine_reason']).toBe('CROSS_TENANT');
  const invalid = await harness.acceptInbox('email.bounced', 'PERMANENT');
  const invalidPort: EmailRetrievalPort = {
    retrieve: async () => ({ kind: 'invalid_tags', reason: 'TAGS_INVALID' }),
  };
  await harness.useCase(invalidPort).execute(invalid);
  expect((await harness.inboxRow(invalid))?.['quarantine_reason']).toBe('TAGS_INVALID');
  expect(await harness.evidence()).toEqual([]);
});

it('quarantines the row once the retrieval attempts are exhausted', async () => {
  const row = await harness.acceptInbox('email.delivered', null);
  const transient: EmailRetrievalPort = {
    retrieve: async () => ({ kind: 'transient', code: 'PROVIDER_503' }),
  };
  for (let attempt = 0; attempt < 7; attempt += 1) await harness.useCase(transient).execute(row);
  const pending = await harness.inboxRow(row);
  expect(pending?.['quarantined_at']).toBeNull();
  expect(pending?.['attempts']).toBe(7);
  await harness.useCase(transient).execute(row);
  const exhausted = await harness.inboxRow(row);
  expect(exhausted?.['quarantine_reason']).toBe('RETRIEVAL_EXHAUSTED');
  expect(await harness.evidence()).toEqual([]);
});

it('reads the suppression of an address on the tenant transaction', async () => {
  const seed = await harness.seedAttempt();
  const row = await harness.acceptInbox('email.bounced', 'PERMANENT');
  await harness.useCase(harness.found(seed)).execute(row);
  const suppressed = await harness.db.withTenant(COMPANY, async (tx) =>
    createEmailSuppressionGate(tx).isSuppressed(HASH),
  );
  const free = await harness.db.withTenant(COMPANY, async (tx) =>
    createEmailSuppressionGate(tx).isSuppressed(Buffer.alloc(32, 3)),
  );
  expect(suppressed).toBe(true);
  expect(free).toBe(false);
});

it('recovers an unconfirmed row and a due row into the real queue', async () => {
  const row = await harness.acceptInbox('email.delivered', null);
  const due = await harness.acceptInbox('email.delivered', null);
  await harness.owner`
    UPDATE platform_email_feedback_inbox SET enqueue_confirmed_at = now(),
      next_attempt_at = ${NOW.toISOString()}::timestamptz WHERE id = ${due}`;
  const enqueued: string[] = [];
  const recover = new RecoverEmailFeedback(
    harness.inbox,
    {
      enqueue: async (id) => {
        enqueued.push(id);
        const job = emailFeedbackJob(id);
        await harness.queue.add(job.name, job.data, job.options);
      },
    },
    { now: () => NOW },
  );
  await recover.execute();
  expect(enqueued.sort()).toEqual([row, due].sort());
  expect((await harness.inboxRow(row))?.['enqueue_confirmed_at']).not.toBeNull();
  expect((await harness.queue.getJob(row))?.data).toEqual({ inbox_id: row });
});

it('clears the raw payload after thirty days and keeps the digest', async () => {
  const old = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
  const row = await harness.acceptInbox('email.delivered', null, old);
  const cleared = await new ClearEmailFeedbackPayloads(harness.inbox, { now: () => NOW }).execute();
  expect(cleared).toBeGreaterThan(0);
  const settled = await harness.inboxRow(row);
  expect(settled?.['raw_event']).toBeNull();
  expect(settled?.['provider_event_digest']).not.toBeNull();
});

it('reads the sweeps by index without a sequential scan', async () => {
  await harness.owner`
    INSERT INTO platform_email_feedback_inbox (id, provider_event_digest, provider_email_id, event_type,
      provider_timestamp, received_at, raw_event, next_attempt_at)
    SELECT gen_random_uuid(), decode(md5(n::text) || md5((n + 1)::text), 'hex'), 'provider-id', 'email.delivered',
      now(), now() - interval '1 day', '{}'::jsonb, now() FROM generate_series(1, 1000) n`;
  await harness.owner`ANALYZE platform_email_feedback_inbox`;
  const sweeps: readonly [string, string][] = [
    [
      'platform_email_feedback_inbox_enqueue_idx',
      `SELECT id FROM public.platform_email_feedback_inbox WHERE enqueue_confirmed_at IS NULL ORDER BY received_at, id LIMIT 100`,
    ],
    [
      'platform_email_feedback_inbox_pending_idx',
      `SELECT id FROM public.platform_email_feedback_inbox WHERE resolved_at IS NULL AND quarantined_at IS NULL AND next_attempt_at IS NOT NULL AND next_attempt_at <= now() ORDER BY next_attempt_at, id LIMIT 100`,
    ],
    [
      'platform_email_feedback_inbox_retention_idx',
      `SELECT id FROM public.platform_email_feedback_inbox WHERE raw_event IS NOT NULL AND received_at <= now() ORDER BY received_at, id LIMIT 100 FOR UPDATE SKIP LOCKED`,
    ],
  ];
  for (const [index, query] of sweeps) {
    const [row] = await harness.platform.withGlobal((tx) =>
      tx.execute(sql.raw(`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`)),
    );
    const plan = JSON.stringify(row?.['QUERY PLAN']);
    expect(plan, index).toContain(index);
    expect(plan, index).not.toContain('"Node Type":"Seq Scan"');
  }
});
