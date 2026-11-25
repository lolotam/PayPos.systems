import type { PlatformEmailDatabase, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  evaluateAttemptBinding,
  type AttemptBindingSnapshot,
  type EmailFeedbackEventType,
} from '../domain/email-feedback.ts';
import type {
  EmailFeedbackInboxRepository,
  EmailFeedbackRow,
  EmailFeedbackSettleInput,
  EmailFeedbackTenantInput,
  EmailFeedbackTenantOutcome,
  EmailFeedbackTenantRepository,
} from '../ports/email-feedback.port.ts';

// مهلة معاملات المنصة: القراءة والتسوية محتاجين وقت أكتر من ميزانية الـ 200ms الافتراضية.
const PLATFORM_TIMEOUT_MS = 5_000;
const TENANT_TIMEOUT_MS = 10_000;
const CLEAR_BATCH_SIZE = 100;
const EVENT_TYPES: readonly EmailFeedbackEventType[] = [
  'email.delivered',
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.suppressed',
  'email.delivery_delayed',
];

/**
 * صندوق ردّ المزود على مستوى المنصة: صفوف عامة، hashes وخلاص، ومن غير عنوان ولا شركة.
 * كل عملية هنا في معاملة واحدة على دور الاستقبال.
 */
export function createEmailFeedbackInboxRepository(
  database: PlatformEmailDatabase,
): EmailFeedbackInboxRepository {
  return {
    pending: (id) => database.withGlobal((tx) => readPending(tx, id), PLATFORM_TIMEOUT_MS),
    quarantine: (id, reason, at) =>
      database.withGlobal(async (tx) => {
        await tx.execute(sql`
          UPDATE public.platform_email_feedback_inbox
          SET quarantined_at = ${at.toISOString()}::timestamptz, quarantine_reason = ${reason}
          WHERE id = ${id}::uuid AND resolved_at IS NULL AND quarantined_at IS NULL`);
      }, PLATFORM_TIMEOUT_MS),
    scheduleRetry: (id, attempts, nextAttemptAt) =>
      database.withGlobal(async (tx) => {
        await tx.execute(sql`
          UPDATE public.platform_email_feedback_inbox
          SET attempts = ${attempts}, next_attempt_at = ${nextAttemptAt.toISOString()}::timestamptz
          WHERE id = ${id}::uuid AND resolved_at IS NULL AND quarantined_at IS NULL`);
      }, PLATFORM_TIMEOUT_MS),
    unconfirmed: () =>
      database.withGlobal(async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          SELECT id FROM public.platform_email_feedback_inbox
          WHERE enqueue_confirmed_at IS NULL ORDER BY received_at, id LIMIT ${CLEAR_BATCH_SIZE}`);
        return rows.map((row) => row.id);
      }, PLATFORM_TIMEOUT_MS),
    due: (now) =>
      database.withGlobal(async (tx) => {
        const rows = await tx.execute<{ id: string }>(sql`
          SELECT id FROM public.platform_email_feedback_inbox
          WHERE resolved_at IS NULL AND quarantined_at IS NULL AND next_attempt_at IS NOT NULL
            AND next_attempt_at <= ${now.toISOString()}::timestamptz
          ORDER BY next_attempt_at, id LIMIT ${CLEAR_BATCH_SIZE}`);
        return rows.map((row) => row.id);
      }, PLATFORM_TIMEOUT_MS),
    confirmEnqueue: (id, at) =>
      database.withGlobal(async (tx) => {
        await tx.execute(sql`
          UPDATE public.platform_email_feedback_inbox SET enqueue_confirmed_at = ${at.toISOString()}::timestamptz
          WHERE id = ${id}::uuid AND enqueue_confirmed_at IS NULL`);
      }, PLATFORM_TIMEOUT_MS),
    clearPayloads: (cutoff) => drainPayloads(database, cutoff),
    settle: (input) => database.withGlobal((tx) => settle(tx, input), PLATFORM_TIMEOUT_MS),
  };
}

/**
 * خطوة الشركة: القفل وتقييم الربط وإثبات الدليل في معاملة مستأجر واحدة.
 * أي رفض بيكتب ولا حاجة في الشركة، والصف بيتعطّل من غيرها.
 */
export function createEmailFeedbackTenantRepository(
  database: Pick<TenantWrappers, 'withTenant'>,
): EmailFeedbackTenantRepository {
  return {
    reconcile: (input) =>
      database.withTenant(input.companyId, (tx) => reconcile(tx, input), {
        timeoutMs: TENANT_TIMEOUT_MS,
      }),
  };
}

async function readPending(tx: Tx, id: string): Promise<EmailFeedbackRow | null> {
  const [row] = await tx.execute<{
    id: string;
    providerEmailId: string;
    eventType: string;
    bounceClass: string | null;
    providerTimestamp: Date;
    providerEventDigest: Buffer;
    attempts: number;
  }>(sql`
    SELECT id, provider_email_id AS "providerEmailId", event_type AS "eventType",
      bounce_class AS "bounceClass", provider_timestamp AS "providerTimestamp",
      provider_event_digest AS "providerEventDigest", attempts
    FROM public.platform_email_feedback_inbox
    WHERE id = ${id}::uuid AND resolved_at IS NULL AND quarantined_at IS NULL`);
  if (row === undefined) return null;
  return {
    id: row.id,
    providerEmailId: row.providerEmailId,
    eventType: eventTypeOf(row.eventType),
    bounceClass: row.bounceClass === null ? null : (row.bounceClass as 'PERMANENT' | 'TRANSIENT'),
    providerTimestamp: new Date(row.providerTimestamp),
    providerEventDigest: row.providerEventDigest,
    attempts: row.attempts,
  };
}

async function settle(tx: Tx, input: EmailFeedbackSettleInput): Promise<boolean> {
  // التسوية الأولى: الصف بيتعلّم محلولاً وبيرجع، فالتكرار بعد انقطاع بيسيب سجل التدقيق واحد.
  const [settled] = await tx.execute<{ id: string }>(sql`
    UPDATE public.platform_email_feedback_inbox SET resolved_at = ${input.at.toISOString()}::timestamptz
    WHERE id = ${input.inboxId}::uuid AND resolved_at IS NULL AND quarantined_at IS NULL RETURNING id`);
  if (settled === undefined) return false;
  const suppression = input.suppression;
  if (suppression === null) return true;
  const hash = Buffer.from(suppression.recipientHash);
  await tx.execute(sql`
    INSERT INTO public.platform_email_suppressions
      (recipient_hash, hash_key_id, source, first_suppressed_at, last_suppressed_at)
    VALUES (${hash}, ${suppression.hashKeyId}, ${suppression.source},
      ${input.at.toISOString()}::timestamptz, ${input.at.toISOString()}::timestamptz)
    ON CONFLICT (recipient_hash) DO UPDATE SET
      last_suppressed_at = GREATEST(public.platform_email_suppressions.last_suppressed_at, EXCLUDED.last_suppressed_at),
      source = EXCLUDED.source`);
  await tx.execute(sql`
    INSERT INTO public.platform_email_audit
      (id, recipient_hash, hash_key_id, source, inbox_id, operator_id, action, reason, occurred_at)
    VALUES (${input.auditId}::uuid, ${hash}, ${suppression.hashKeyId}, ${suppression.source},
      ${input.inboxId}::uuid, NULL, 'SUPPRESS', ${suppression.reason},
      ${input.at.toISOString()}::timestamptz)`);
  return true;
}

async function reconcile(
  tx: Tx,
  input: EmailFeedbackTenantInput,
): Promise<EmailFeedbackTenantOutcome> {
  const [row] = await tx.execute<{
    companyId: string;
    channel: string;
    executionId: string | null;
    status: string;
    outcomeKnown: boolean | null;
    providerMessageId: string | null;
    recipientHash: Buffer;
    hashKeyId: string;
  }>(sql`
    SELECT company_id AS "companyId", channel, execution_id AS "executionId", status,
      outcome_known AS "outcomeKnown", provider_message_id AS "providerMessageId",
      recipient_hash AS "recipientHash", hash_key_id AS "hashKeyId"
    FROM notification_attempts
    WHERE company_id = app_company_id() AND id = ${input.attemptId}::uuid FOR UPDATE`);
  const snapshot: AttemptBindingSnapshot | null =
    row === undefined
      ? null
      : {
          companyId: row.companyId,
          channel: row.channel,
          executionId: row.executionId,
          status: row.status,
          outcomeKnown: row.outcomeKnown,
          providerMessageId: row.providerMessageId,
          recipientHash: row.recipientHash,
          hashKeyId: row.hashKeyId,
        };
  const decision = evaluateAttemptBinding(snapshot, {
    companyId: input.companyId,
    executionId: input.executionId,
    providerEmailId: input.providerEmailId,
    recipientHash: input.recipientHash,
    hashKeyId: input.hashKeyId,
  });
  if (!decision.ok) return { ok: false, reason: decision.reason };
  const bound = decision.bindProviderMessageId ? await bindProviderId(tx, input) : false;
  const recorded = await recordEvidence(tx, input);
  return { ok: true, bound, recorded };
}

// الربط بيتكتب طول ما المحاولة لسه قابلة للتغيير؛ حالة FAILED نهائية وguard القاعدة بيمنع تعديلها.
async function bindProviderId(tx: Tx, input: EmailFeedbackTenantInput): Promise<boolean> {
  const rows = await tx.execute(sql`
    UPDATE notification_attempts
    SET provider_message_id = ${input.providerEmailId}, updated_at = ${input.recordedAt.toISOString()}::timestamptz
    WHERE company_id = app_company_id() AND id = ${input.attemptId}::uuid
      AND provider_message_id IS NULL AND status = 'SENDING'
    RETURNING id`);
  return rows.length === 1;
}

async function recordEvidence(tx: Tx, input: EmailFeedbackTenantInput): Promise<boolean> {
  const rows = await tx.execute(sql`
    INSERT INTO notification_attempt_feedback
      (company_id, id, attempt_id, event_type, bounce_class, provider_event_digest, provider_timestamp, recorded_at)
    VALUES (${input.companyId}::uuid, ${input.feedbackId}::uuid, ${input.attemptId}::uuid,
      ${input.eventType}, ${input.bounceClass}, ${Buffer.from(input.providerEventDigest)},
      ${input.providerTimestamp.toISOString()}::timestamptz, ${input.recordedAt.toISOString()}::timestamptz)
    ON CONFLICT (company_id, provider_event_digest) DO NOTHING RETURNING id`);
  return rows.length === 1;
}

async function drainPayloads(database: PlatformEmailDatabase, cutoff: Date): Promise<number> {
  let cleared = 0;
  for (let batch = 0; batch < 100; batch += 1) {
    const count = await database.withGlobal(async (tx) => {
      const rows = await tx.execute(sql`WITH batch AS (
        SELECT id FROM public.platform_email_feedback_inbox WHERE raw_event IS NOT NULL
          AND received_at <= ${cutoff.toISOString()}::timestamptz
        ORDER BY received_at, id LIMIT ${CLEAR_BATCH_SIZE} FOR UPDATE SKIP LOCKED)
        UPDATE public.platform_email_feedback_inbox SET raw_event = NULL
        WHERE id IN (SELECT id FROM batch) RETURNING id`);
      return rows.length;
    }, PLATFORM_TIMEOUT_MS);
    cleared += count;
    if (count < CLEAR_BATCH_SIZE) break;
  }
  return cleared;
}

function eventTypeOf(value: string): EmailFeedbackEventType {
  const found = EVENT_TYPES.find((type) => type === value);
  if (found === undefined) throw new Error('EMAIL_FEEDBACK_EVENT_INVALID');
  return found;
}
