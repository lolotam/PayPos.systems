import {
  createDatabase,
  createPlatformEmailDatabase,
  type Database,
  type PlatformEmailDatabase,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createEmailIdentity,
  createProviderMessageDigest,
  createResendEventDigest,
  EMAIL_FEEDBACK_QUEUE,
} from '@pospay/notifications';
import { Queue } from 'bullmq';
import postgres from 'postgres';

import { TENANT, seedTwoTenants } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createTestDatabase } from '../../../../../../packages/db/test/test-database.ts';
import { createEmailFeedbackInboxRepository as createIntake } from '../../../../../api/src/modules/notifications/persistence/drizzle-email-feedback.repository.ts';
import type { EmailRetrievalPort } from '../ports/email-feedback.port.ts';
import { createAttemptsRepository } from '../persistence/drizzle-attempts.repository.ts';
import { createAuthEmailFeedbackRepository } from '../persistence/auth-email-feedback.repository.ts';
import {
  createEmailFeedbackInboxRepository,
  createEmailFeedbackTenantRepository,
} from '../persistence/drizzle-email-feedback-inbox.repository.ts';
import { ReconcileEmailFeedback } from '../use-cases/reconcile-email-feedback/reconcile-email-feedback.ts';

export const EMAIL = 'synthetic.owner@example.invalid';
export const COMPANY = TENANT.A.company;
export const PROVIDER_ID = '01920000-0000-7000-8000-000000000004';
export const OTHER_ID = '01920000-0000-7000-8000-000000000009';
export const KEY_ID = 'email-test-v1';
export const NOW = new Date('2026-11-24T10:00:00Z');
export const identity = createEmailIdentity('synthetic-feedback-identity'.repeat(3), KEY_ID);
export const HASH = identity.identify(EMAIL).hash;
const digest = createResendEventDigest(Buffer.from('synthetic-feedback-digest'.repeat(2), 'utf8'));
export const messageDigest = createProviderMessageDigest(
  'synthetic-message-digest'.repeat(2),
  'email-test-v1',
);
export const ids = systemUuidV7();
// The compose Redis (T2): REDIS_URL when set, otherwise built from REDIS_PASSWORD as CI writes it.
const redisUrl =
  process.env['REDIS_URL'] ??
  `redis://:${encodeURIComponent(process.env['REDIS_PASSWORD'] ?? '')}@127.0.0.1:6379`;

export type Seed = { id: string; executionId: string; sourceEventId: string };

function attemptSeeder(owner: postgres.Sql) {
  return async (options: { sent?: boolean; providerId?: string } = {}): Promise<Seed> => {
    const id = ids.newId();
    const executionId = ids.newId();
    const sourceEventId = ids.newId();
    await owner`
      INSERT INTO notification_attempts (company_id,id,source_event_id,channel,template_key,template_revision,
        locale,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,authorized_at,recipient_email,
        sending_at,execution_id,provider_message_id,created_at,updated_at)
      VALUES (${COMPANY},${id},${sourceEventId},'email','document_expiring',1,'en',
        ${HASH},${KEY_ID},NULL,'[]','PENDING',now(),${EMAIL},NULL,NULL,${options.providerId ?? null},now(),now())`;
    await owner`
      UPDATE notification_attempts SET status='SENDING', sending_at=now(), execution_id=${executionId} WHERE id=${id}`;
    if (options.sent === true)
      await owner`
        UPDATE notification_attempts SET status='SENT', recipient_email=NULL, finished_at=now(),
          outcome_known=true WHERE id=${id}`;
    return { id, executionId, sourceEventId };
  };
}

export function inboxAcceptor(platform: PlatformEmailDatabase) {
  return async (
    eventType: string,
    bounceClass: 'PERMANENT' | 'TRANSIENT' | null,
    receivedAt: Date = NOW,
  ): Promise<string> => {
    const accepted = await createIntake(platform, ids).accept(
      {
        digest: digest(ids.newId()),
        type: eventType,
        emailId: PROVIDER_ID,
        bounceClass,
        providerTimestamp: NOW,
        envelope: { type: eventType, created_at: NOW.toISOString(), email_id: PROVIDER_ID },
      },
      receivedAt,
      1000,
    );
    if (!accepted.inserted) throw new Error('TEST_INBOX_INSERT_FAILED');
    return accepted.id;
  };
}

function foundProvider(seed: Seed, overrides: Record<string, unknown> = {}): EmailRetrievalPort {
  return {
    retrieve: async () => ({
      kind: 'found' as const,
      id: PROVIDER_ID,
      tags: {
        companyId: COMPANY,
        authChallengeId: null,
        attemptId: seed.id,
        executionId: seed.executionId,
      },
      recipientHash: HASH,
      hashKeyId: KEY_ID,
      ...overrides,
    }),
  };
}

function readers(owner: postgres.Sql) {
  return {
    inboxRow: async (id: string) =>
      (await owner`SELECT * FROM platform_email_feedback_inbox WHERE id = ${id}`)[0],
    evidence: async () =>
      owner`SELECT company_id, attempt_id, event_type FROM notification_attempt_feedback`,
    suppressions: async () => owner`SELECT recipient_hash, source FROM platform_email_suppressions`,
    audits: async () => owner`SELECT source, reason, action FROM platform_email_audit`,
  };
}

export interface EmailFeedbackHarness {
  readonly db: Database;
  readonly owner: postgres.Sql;
  readonly platform: PlatformEmailDatabase;
  readonly inbox: ReturnType<typeof createEmailFeedbackInboxRepository>;
  readonly tenant: ReturnType<typeof createEmailFeedbackTenantRepository>;
  readonly attempts: ReturnType<typeof createAttemptsRepository>;
  readonly queue: Queue;
  readonly testDb: Awaited<ReturnType<typeof createTestDatabase>>;
  seedAttempt(options?: { sent?: boolean; providerId?: string }): Promise<Seed>;
  acceptInbox(
    eventType: string,
    bounceClass: 'PERMANENT' | 'TRANSIENT' | null,
    receivedAt?: Date,
  ): Promise<string>;
  found(seed: Seed, overrides?: Record<string, unknown>): EmailRetrievalPort;
  useCase(
    retrieval: EmailRetrievalPort,
    tenantPort?: ReturnType<typeof createEmailFeedbackTenantRepository>,
    inboxPort?: ReturnType<typeof createEmailFeedbackInboxRepository>,
  ): ReconcileEmailFeedback;
  inboxRow(id: string): Promise<Record<string, unknown> | undefined>;
  evidence(): Promise<unknown[]>;
  suppressions(): Promise<unknown[]>;
  audits(): Promise<unknown[]>;
  close(): Promise<void>;
}

export async function emailFeedbackHarness(): Promise<EmailFeedbackHarness> {
  const testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const db = createDatabase({ url: testDb.appUrl, ids });
  const owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  const platform = createPlatformEmailDatabase({ url: testDb.notificationsUrl });
  const inbox = createEmailFeedbackInboxRepository(platform);
  const tenant = createEmailFeedbackTenantRepository(db);
  const attempts = createAttemptsRepository(db);
  const queue = new Queue(EMAIL_FEEDBACK_QUEUE, {
    connection: { url: redisUrl },
    prefix: `email-feedback-test-${ids.newId()}`,
  });
  const read = readers(owner);
  return {
    db,
    owner,
    platform,
    inbox,
    tenant,
    attempts,
    queue,
    testDb,
    seedAttempt: attemptSeeder(owner),
    acceptInbox: inboxAcceptor(platform),
    found: foundProvider,
    useCase: (retrieval, tenantPort = tenant, inboxPort = inbox) =>
      new ReconcileEmailFeedback(
        inboxPort,
        tenantPort,
        createAuthEmailFeedbackRepository({
          reconcileAuthAttempt: async () => ({
            kind: 'refused' as const,
            reason: 'EXECUTION_MISSING' as const,
          }),
        }),
        retrieval,
        { now: () => NOW },
        ids,
        (providerMessageId: string) => messageDigest(providerMessageId),
      ),
    ...read,
    close: async () => {
      await queue.close();
      await platform.close();
      await owner.end();
      await db.close();
      await testDb.drop();
    },
  };
}

/** كل اختبار يبدأ من صفوف فاضية: الدليل والمنع والتدقيق والصندوق. */
export async function clearFeedbackRows(owner: postgres.Sql): Promise<void> {
  await owner`DELETE FROM notification_attempt_feedback`;
  await owner`DELETE FROM notification_attempts`;
  await owner`DELETE FROM platform_email_audit`;
  await owner`DELETE FROM platform_email_suppressions`;
  await owner`DELETE FROM platform_email_feedback_inbox`;
}
