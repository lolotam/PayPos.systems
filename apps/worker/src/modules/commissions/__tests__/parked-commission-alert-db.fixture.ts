import {
  canonicalOwnerSql,
  createDatabase,
  createOutboxDispatcherDatabase,
  OWNER_ROLE_ID,
  type Database,
  type DeliveryOutcome,
  type OutboxDispatcherDatabase,
  type Tx,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { createLogger } from '@pospay/observability';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach } from 'vitest';

import { asReplicaOwner } from '../../../../../../packages/db/test/owner-cleanup.ts';
import {
  eventId,
  pendingCountHarness,
} from '../../../../../../packages/db/test/statement-pending-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { createParkedCommissionSweep } from '../../../outbox/parked-commission-sweep.ts';
import {
  createParkedCommissionAlert,
  PARKED_ALERT_CONSUMER_ID,
  type ParkedAlertOutcome,
  type ParkedCommissionEvent,
} from '../index.ts';

export const A = TENANT.A;
export const B = TENANT.B;
export const COUNTED = 'SalaryChanged';
export const UNCOUNTED = 'OrderCompleted';
export const OWNER_A = '01920000-0000-7000-8000-0000000000e1';
export const OWNER_B = '01920000-0000-7000-8000-0000000000e2';
export const MEMBERSHIP_A = '01920000-0000-7000-8000-0000000000d1';
export const MEMBERSHIP_B = '01920000-0000-7000-8000-0000000000d2';
export { eventId, PARKED_ALERT_CONSUMER_ID };

export const ids = systemUuidV7();
export const clock = { now: () => new Date() };

let testDb: TestDatabase;
export let owner: postgres.Sql;
export let app: postgres.Sql;
export let appUrl: string;
export let dispatcherUrl: string;
export let db: Database;
export let dispatcher: OutboxDispatcherDatabase;
export let parkAlert: (event: ParkedCommissionEvent) => Promise<ParkedAlertOutcome>;

const { asApp, pending, seedEvent, markEvent, clean } = pendingCountHarness(
  () => owner,
  () => app,
);

/** مالكي الشركة: نسخة محلية من قارئ الهوية، لأن حد الموديول بيمنع استيراد شريط موديول تاني. */
async function owners(tx: Tx, company: string, at: Date): Promise<readonly string[]> {
  const moment = at.toISOString();
  const rows = await tx.execute<{ user_id: string }>(sql`SELECT m.user_id FROM memberships m
    WHERE m.company_id = ${company} AND m.user_id IS NOT NULL
      AND m.starts_at <= ${moment}::timestamptz
      AND (m.ends_at IS NULL OR m.ends_at > ${moment}::timestamptz)
      AND ${canonicalOwnerSql('m', company)}
    ORDER BY m.user_id`);
  return rows.map((row) => row.user_id).sort();
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  appUrl = testDb.appUrl;
  dispatcherUrl = testDb.dispatcherUrl;
  db = createDatabase({ url: testDb.appUrl, ids });
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl });
  for (const [userId, email] of [
    [OWNER_A, 'park-alert-owner-a@example.test'],
    [OWNER_B, 'park-alert-owner-b@example.test'],
  ] as const) {
    await owner`INSERT INTO "user"(id, name, email, email_verified, created_at, updated_at)
      VALUES (${userId}, 'Synthetic park owner', ${email}, true, now(), now())
      ON CONFLICT DO NOTHING`;
  }
  parkAlert = createParkedCommissionAlert({ database: db, ids, clock, owners });
});

afterAll(async () => {
  await dispatcher?.close();
  await db?.close();
  await app?.end();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  await clean();
  await asReplicaOwner(owner, (tx) =>
    tx`DELETE FROM memberships WHERE user_id IN (${OWNER_A}, ${OWNER_B})`,
  );
});

export async function seedOwner(
  company: string,
  membership: string,
  userId: string,
): Promise<void> {
  await owner`INSERT INTO memberships(company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${membership}, ${userId}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${company})`;
}

export const failPermanently = async (): Promise<DeliveryOutcome> => ({
  delivered: false,
  error: 'synthetic delivery failure',
  retryInMs: null,
});

/** نسخة ثانية من الاتصال بقاعدة البيانات: عامل ثانٍ بيشتغل في نفس اللحظة. */
export async function replicaAlert(): Promise<{
  readonly alert: (event: ParkedCommissionEvent) => Promise<ParkedAlertOutcome>;
  readonly close: () => Promise<void>;
}> {
  const replica = createDatabase({ url: appUrl, ids });
  return {
    alert: createParkedCommissionAlert({ database: replica, ids, clock, owners }),
    close: () => replica.close(),
  };
}

export interface SweepOptions {
  readonly raiseAlert?: (event: ParkedCommissionEvent) => Promise<ParkedAlertOutcome>;
  readonly pageSize?: number;
  readonly maxTransactionsPerSweep?: number;
}

/** مسح جديد كل مرة: ذاكرة فاضية، زي عامل جديد بدأ. */
export function freshSweep(options: SweepOptions = {}): () => Promise<void> {
  return createParkedCommissionSweep({
    readPage: (afterSeq, limit) => dispatcher.commissionParkedEventPage(afterSeq, limit),
    raiseAlert: options.raiseAlert ?? parkAlert,
    logger: createLogger('silent'),
    ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
    ...(options.maxTransactionsPerSweep === undefined
      ? {}
      : { maxTransactionsPerSweep: options.maxTransactionsPerSweep }),
  });
}

export const parkedRow = (event: string) =>
  owner<{ parked_at: Date | null }[]>`SELECT parked_at FROM outbox WHERE id = ${event}`;

export const alertMarks = (event: string) =>
  owner<{ event_id: string }[]>`
    SELECT event_id FROM consumed_events
    WHERE consumer_id = ${PARKED_ALERT_CONSUMER_ID} AND event_id = ${event}`;

export interface NoticePayload {
  readonly event_id: string;
  readonly event_type: string;
  readonly group_index: number;
  readonly notification_recipients: readonly { channel: string; user_id: string }[];
}

export const notices = (company: string) =>
  owner<{ id: string; aggregate_type: string; aggregate_id: string; payload: NoticePayload }[]>`
    SELECT id::text AS id, aggregate_type, aggregate_id::text AS aggregate_id, payload FROM outbox
    WHERE company_id = ${company} AND event_type = 'CommissionEventParkedNoticeRequested'
    ORDER BY id`;

export { asApp, pending, seedEvent, markEvent, clean };
