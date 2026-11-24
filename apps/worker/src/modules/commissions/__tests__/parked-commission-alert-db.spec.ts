import {
  canonicalOwnerSql,
  createDatabase,
  createOutboxDispatcherDatabase,
  OWNER_ROLE_ID,
  type ClaimedEvent,
  type Database,
  type DeliveryOutcome,
  type OutboxDispatcherDatabase,
  type Tx,
} from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { asReplicaOwner } from '../../../../../../packages/db/test/owner-cleanup.ts';
import {
  eventId,
  pendingCountHarness,
} from '../../../../../../packages/db/test/statement-pending-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createParkedCommissionAlert,
  PARKED_ALERT_CONSUMER_ID,
  type ParkedAlertOutcome,
  type ParkedCommissionEvent,
} from '../index.ts';

// Real dispatcher + real pospay_app/pospay_dispatcher roles on a cloned, migrated database.
// The hook the worker wires in main.ts is reproduced here with the production use case.
const { A, B } = TENANT;
const OWNER_A = '01920000-0000-7000-8000-0000000000e1';
const OWNER_B = '01920000-0000-7000-8000-0000000000e2';
const MEMBERSHIP_A = '01920000-0000-7000-8000-0000000000d1';
const MEMBERSHIP_B = '01920000-0000-7000-8000-0000000000d2';
const COUNTED = 'SalaryChanged';
const UNCOUNTED = 'OrderCompleted';

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
let db: Database;
let dispatcher: OutboxDispatcherDatabase;
let parkAlert: (event: ParkedCommissionEvent) => Promise<ParkedAlertOutcome>;

const ids = systemUuidV7();
const clock = { now: () => new Date() };
const { asApp, pending, seedEvent, clean } = pendingCountHarness(
  () => owner,
  () => app,
);

// Local copy of identity's companyOwners: the module boundary forbids importing the identity barrel.
// Same query, same canonicalOwnerSql, so the alert is exercised with the production owner semantics.
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

async function seedOwner(company: string, membership: string, userId: string): Promise<void> {
  await owner`INSERT INTO memberships(company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${membership}, ${userId}, ${OWNER_ROLE_ID}, 'global', 'COMPANY', ${company})`;
}

function parkedRow(event: string) {
  return owner<{ parked_at: Date | null }[]>`SELECT parked_at FROM outbox WHERE id = ${event}`;
}

function alertMarks(event: string) {
  return owner<{ event_id: string }[]>`
    SELECT event_id FROM consumed_events
    WHERE consumer_id = ${PARKED_ALERT_CONSUMER_ID} AND event_id = ${event}`;
}

interface NoticePayload {
  event_id: string;
  event_type: string;
  group_index: number;
  notification_recipients: readonly { channel: string; user_id: string }[];
}

function notices(company: string) {
  return owner<{ aggregate_type: string; aggregate_id: string; payload: NoticePayload }[]>`
    SELECT aggregate_type, aggregate_id, payload FROM outbox
    WHERE company_id = ${company} AND event_type = 'CommissionEventParkedNoticeRequested'`;
}

const failPermanently = async (): Promise<DeliveryOutcome> => ({
  delivered: false,
  error: 'synthetic delivery failure',
  retryInMs: null,
});

/** Reproduces main.ts: dispatchBatch does not await the hook, so the test awaits it explicitly. */
function captureHook() {
  const outcomes: ParkedAlertOutcome[] = [];
  let done: Promise<void> = Promise.resolve();
  const onParked = (events: readonly ClaimedEvent[]): Promise<void> => {
    done = Promise.all(
      events.map(async (event) => {
        outcomes.push(
          await parkAlert({
            companyId: event.companyId,
            eventId: event.id,
            eventType: event.eventType,
          }),
        );
      }),
    ).then(() => undefined);
    return done;
  };
  return { onParked, outcomes, settle: () => done };
}

async function expectOneNotice(event: string, ownerId: string): Promise<void> {
  expect(await alertMarks(event)).toEqual([{ event_id: event }]);
  const rows = await notices(A.company);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    aggregate_type: 'commission_parked_event',
    aggregate_id: event,
  });
  const payload = rows[0]?.payload;
  expect(payload?.event_id).toBe(event.toLowerCase());
  expect(payload?.event_type).toBe(COUNTED);
  expect(payload?.notification_recipients).toEqual([
    expect.objectContaining({ channel: 'IN_APP', user_id: ownerId }),
  ]);
}

it('a counted event parked after a failed delivery raises one notice to the company\'s owners', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(1);
  await seedEvent(A.company, event, COUNTED);
  const hook = captureHook();
  expect(await dispatcher.dispatchBatch(100, failPermanently, { onParked: hook.onParked })).toBe(1);
  await hook.settle();
  expect((await parkedRow(event))[0]?.parked_at).toBeInstanceOf(Date);
  await expectOneNotice(event, OWNER_A);
});

it('a counted event parked by an expired lease at the last attempt raises the notice too', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(2);
  await seedEvent(A.company, event, COUNTED, {
    attempts: 10,
    nextAttemptAt: '2020-01-01T00:00:00Z',
    lastError: 'synthetic lease expiry',
  });
  const hook = captureHook();
  await dispatcher.dispatchBatch(100, failPermanently, {
    onParked: hook.onParked,
    maxAttempts: 10,
  });
  await hook.settle();
  expect((await parkedRow(event))[0]?.parked_at).toBeInstanceOf(Date);
  await expectOneNotice(event, OWNER_A);
});

it('a second park of the same event id raises nothing more', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(3);
  await seedEvent(A.company, event, COUNTED);
  const hook = captureHook();
  await dispatcher.dispatchBatch(100, failPermanently, { onParked: hook.onParked });
  await hook.settle();
  await expect(
    parkAlert({ companyId: A.company, eventId: event, eventType: COUNTED }),
  ).resolves.toBe('ALREADY_ALERTED');
  expect(await alertMarks(event)).toEqual([{ event_id: event }]);
  expect(await notices(A.company)).toHaveLength(1);
});

it('a parked event of another type raises no notice and writes no mark', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(4);
  await seedEvent(A.company, event, UNCOUNTED);
  const hook = captureHook();
  await dispatcher.dispatchBatch(100, failPermanently, { onParked: hook.onParked });
  await hook.settle();
  expect((await parkedRow(event))[0]?.parked_at).toBeInstanceOf(Date);
  expect(hook.outcomes).toEqual(['NOT_A_COMMISSION_EVENT']);
  expect(await alertMarks(event)).toEqual([]);
  expect(await notices(A.company)).toEqual([]);
});

it('a company with no owner gets no notice and no mark', async () => {
  const event = eventId(5);
  await seedEvent(A.company, event, COUNTED);
  const hook = captureHook();
  await dispatcher.dispatchBatch(100, failPermanently, { onParked: hook.onParked });
  await hook.settle();
  expect((await parkedRow(event))[0]?.parked_at).toBeInstanceOf(Date);
  expect(hook.outcomes).toEqual(['NO_OWNERS']);
  expect(await alertMarks(event)).toEqual([]);
  expect(await notices(A.company)).toEqual([]);
});

it('the owners of another company receive nothing, and the mark is not visible to that company', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  await seedOwner(B.company, MEMBERSHIP_B, OWNER_B);
  const event = eventId(6);
  await seedEvent(A.company, event, COUNTED);
  const hook = captureHook();
  await dispatcher.dispatchBatch(100, failPermanently, { onParked: hook.onParked });
  await hook.settle();

  expect(await alertMarks(event)).toEqual([{ event_id: event }]);
  expect(await notices(A.company)).toHaveLength(1);
  expect(await notices(B.company)).toEqual([]);
  const inA = await asApp(A.company, (tx) =>
    tx<{ n: string }[]>`SELECT count(*)::text AS n FROM consumed_events WHERE event_id = ${event}`,
  );
  const inB = await asApp(B.company, (tx) =>
    tx<{ n: string }[]>`SELECT count(*)::text AS n FROM consumed_events WHERE event_id = ${event}`,
  );
  expect(inA[0]?.n).toBe('1');
  expect(inB[0]?.n).toBe('0');
});

it('a parked counted event still counts as pending for approval', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(7);
  await seedEvent(A.company, event, COUNTED);
  const hook = captureHook();
  await dispatcher.dispatchBatch(100, failPermanently, { onParked: hook.onParked });
  await hook.settle();

  expect(await alertMarks(event)).toEqual([{ event_id: event }]);
  expect(await asApp(A.company, (tx) => pending(tx))).toBe('1');
});

it('a failing alert callback never breaks the dispatch batch', async () => {
  const throwing = (): void => {
    throw new Error('synthetic hook throw');
  };
  const rejecting = async (): Promise<void> => {
    throw new Error('synthetic hook rejection');
  };

  await clean();
  const thrown = eventId(81);
  await seedEvent(A.company, thrown, COUNTED);
  await expect(
    dispatcher.dispatchBatch(100, failPermanently, { onParked: throwing }),
  ).resolves.toBe(1);
  expect((await parkedRow(thrown))[0]?.parked_at).toBeInstanceOf(Date);

  await clean();
  const rejected = eventId(82);
  await seedEvent(A.company, rejected, COUNTED);
  await expect(
    dispatcher.dispatchBatch(100, failPermanently, { onParked: rejecting }),
  ).resolves.toBe(1);
  expect((await parkedRow(rejected))[0]?.parked_at).toBeInstanceOf(Date);
});
