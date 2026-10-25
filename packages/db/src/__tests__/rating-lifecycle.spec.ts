import { systemUuidV7 } from '@pospay/ids';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  claimRequest,
  consumeAndRate,
  expectPgError,
  insertPerformer,
  insertRequest,
  OTHER_RATING_BUSINESS,
  RATING_TENANT,
  seedRatingTenants,
} from '../../test/rating-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const NOW = '2026-06-02T00:00:00Z';
let sequence = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function nextDate(): string {
  sequence += 1;
  return new Date(Date.UTC(2026, 9, sequence)).toISOString().slice(0, 10);
}

async function newRequest(): Promise<string> {
  return db.withTenant(A.company, (tx) => insertRequest(tx, { tenant: A, date: nextDate() }));
}

async function claim(id: string, performers = [A.employees[0]]): Promise<Buffer> {
  const tokenHash = Buffer.alloc(32, (sequence % 200) + 1);
  await db.withTenant(A.company, (tx) =>
    claimRequest(tx, {
      tenant: A,
      requestId: id,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers,
    }),
  );
  return tokenHash;
}

async function prepareState(
  state: 'SENDING' | 'SENT' | 'PAST_DEADLINE' | 'OPTED_OUT',
): Promise<string> {
  if (state === 'PAST_DEADLINE' || state === 'OPTED_OUT') {
    return db.withTenant(A.company, (tx) =>
      insertRequest(tx, {
        tenant: A,
        date: nextDate(),
        status: 'CANCELLED',
        cancelReason: state,
      }),
    );
  }
  const id = await newRequest();
  await claim(id);
  if (state === 'SENT') {
    await db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE rating_requests SET status='SENT',sent_at=${NOW} WHERE id=${id}`),
    );
  }
  return id;
}

function update(id: string, changes: SQL): Promise<unknown> {
  return db.withTenant(A.company, (tx) =>
    tx.execute(
      sql`UPDATE rating_requests SET ${changes} WHERE company_id=${A.company} AND id=${id}`,
    ),
  );
}

it('the insert guard accepts cancellation but refuses SENT or a token at insert', async () => {
  const cancelled = await db.withTenant(A.company, (tx) =>
    insertRequest(tx, {
      tenant: A,
      date: nextDate(),
      status: 'CANCELLED',
      cancelReason: 'NO_ACTIVE_LINE',
    }),
  );
  expect(cancelled).not.toBe('');
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertRequest(tx, { tenant: A, date: nextDate(), status: 'SENT' }),
    ),
    '23514',
    'rating_requests_insert_state',
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertRequest(tx, {
        tenant: A,
        date: nextDate(),
        status: 'SENDING',
        tokenHash: Buffer.alloc(32, 201),
      }),
    ),
    '23514',
    'rating_requests_insert_state',
  );
});

it('reschedules, claims and sends through the full happy path', async () => {
  const id = await newRequest();
  const dueAt = '2026-06-03T00:00:00.000Z';
  await update(id, sql`due_at=${dueAt}`);
  await claim(id);
  await update(id, sql`status='SENT',sent_at=${NOW}`);
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute<{ status: string; due_at: unknown }>(
      sql`SELECT status,due_at FROM rating_requests WHERE id=${id}`,
    ),
  );
  expect(rows[0]?.status).toBe('SENT');
  expect(new Date(String(rows[0]?.due_at)).toISOString()).toBe(dueAt);
});

it('writes the send time once and refuses a different one', async () => {
  const id = await newRequest();
  await claim(id);
  await update(id, sql`status='SENT',sent_at=${NOW}`);
  await expectPgError(
    update(id, sql`sent_at='2026-06-03T00:00:00Z'`),
    '23514',
    'rating_requests_sent_once',
  );
  await update(id, sql`sent_at=${NOW}`);
});

const REFUSED_TRANSITIONS = [
  { from: 'SENT', to: 'SENDING' },
  { from: 'SENDING', to: 'SCHEDULED' },
  { from: 'SENDING', to: 'CANCELLED' },
  { from: 'PAST_DEADLINE', to: 'SCHEDULED' },
  { from: 'OPTED_OUT', to: 'SCHEDULED' },
] as const;

it.each(REFUSED_TRANSITIONS)('refuses $from to $to', async ({ from, to }) => {
  const id = await prepareState(from);
  const reason = to === 'CANCELLED' ? sql`,cancel_reason='OPTED_OUT'` : sql``;
  await expectPgError(
    update(id, sql`status=${to}${reason}`),
    '23514',
    'rating_requests_transition',
  );
});

it('keeps terminal cancellation reasons terminal', async () => {
  const id = await prepareState('PAST_DEADLINE');
  await expectPgError(
    update(id, sql`status='CANCELLED',cancel_reason='OPTED_OUT'`),
    '23514',
    'rating_requests_transition',
  );
});

it('reopens NO_ACTIVE_LINE and later accepts PAST_DEADLINE', async () => {
  const id = await db.withTenant(A.company, (tx) =>
    insertRequest(tx, {
      tenant: A,
      date: nextDate(),
      status: 'CANCELLED',
      cancelReason: 'NO_ACTIVE_LINE',
    }),
  );
  await update(id, sql`status='SCHEDULED',cancel_reason=NULL`);
  await update(id, sql`status='CANCELLED',cancel_reason='NO_ACTIVE_LINE'`);
  await update(id, sql`status='CANCELLED',cancel_reason='PAST_DEADLINE'`);
});

const FROZEN_CHANGES = [
  ['token_hash', sql`token_hash=${Buffer.alloc(32, 202)}`],
  ['token_key_version', sql`token_key_version=2`],
  ['expires_at', sql`expires_at='2026-06-10T00:00:00Z'`],
  ['claimed_at', sql`claimed_at='2026-06-03T00:00:00Z'`],
  ['ready_event_id', sql`ready_event_id=${ids.newId()}`],
  ['branch_id', sql`branch_id=${OTHER_RATING_BUSINESS.branch}`],
] as const;

it.each(FROZEN_CHANGES)('freezes %s after the claim', async (_column, change) => {
  const id = await prepareState('SENDING');
  await expectPgError(update(id, change), '23514', 'rating_requests_claim_frozen');
});

it('still permits due_at and send_deadline after the claim', async () => {
  const id = await prepareState('SENDING');
  await update(id, sql`due_at='2026-06-04T00:00:00Z',send_deadline='2026-06-04T01:00:00Z'`);
});

const IDENTITY_CHANGES = [
  `company_id='${B.company}'`,
  "id='01920000-0000-7000-8000-000000000fff'",
  `business_id='${OTHER_RATING_BUSINESS.business}'`,
  `customer_id='${B.customer}'`,
  "business_date='2027-01-01'",
  "created_at='2026-01-01T00:00:00Z'",
];

it.each(IDENTITY_CHANGES)('the update trigger refuses identity change %#', async (change) => {
  const id = await newRequest();
  await expectPgError(
    owner.unsafe(`UPDATE rating_requests SET ${change} WHERE id='${id}'`),
    '23514',
    'rating_requests_identity_immutable',
  );
});

const GRANT_DENIALS = [
  sql`business_id=${OTHER_RATING_BUSINESS.business}`,
  sql`customer_id=${B.customer}`,
  sql`business_date='2027-01-01'`,
  sql`created_at='2026-01-01T00:00:00Z'`,
  sql`claim_xact_id='1'::xid8`,
  sql`consume_xact_id='1'::xid8`,
];

it.each(GRANT_DENIALS)('the app grant refuses identity/proof write %#', async (change) => {
  const id = await newRequest();
  await expectPgError(update(id, change), '42501');
});

it('sets consumed_at once and never clears or changes it', async () => {
  const id = await newRequest();
  const tokenHash = await claim(id);
  await db.withTenant(A.company, (tx) =>
    consumeAndRate(tx, {
      tenant: A,
      requestId: id,
      tokenHash,
      now: NOW,
      stars: 5,
      attribute: [A.employees[0]],
    }),
  );
  await expectPgError(update(id, sql`consumed_at=NULL`), '23514', 'rating_requests_consumed_once');
  await expectPgError(
    update(id, sql`consumed_at='2026-06-03T00:00:00Z'`),
    '23514',
    'rating_requests_consumed_once',
  );
});

it('freezes the performer snapshot once the link is consumed', async () => {
  let requestId = '';
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = Buffer.alloc(32, (sequence % 200) + 1);
      await claimRequest(tx, {
        tenant: A,
        requestId,
        tokenHash,
        readyEventId: ids.newId(),
        now: NOW,
        performers: [A.employees[0]],
      });
      await consumeAndRate(tx, {
        tenant: A,
        requestId,
        tokenHash,
        now: NOW,
        stars: 5,
        attribute: [A.employees[0]],
      });
      await tx.execute(sql`SET CONSTRAINTS ratings_attributions_complete IMMEDIATE`);
      await insertPerformer(tx, { tenant: A, requestId, employeeId: A.employees[1] });
    }),
    '23514',
    'rating_performers_claim_only',
  );
  expect(await owner`SELECT id FROM rating_requests WHERE id=${requestId}`).toEqual([]);
});
