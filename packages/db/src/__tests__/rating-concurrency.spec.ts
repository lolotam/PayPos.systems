import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import { createGate, waitForBlockedAppSession } from '../../test/rating-concurrency-fixtures.ts';
import {
  claimRequest,
  consumeRequest,
  expectPgError,
  insertAttribution,
  insertPerformer,
  insertRating,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
} from '../../test/rating-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A } = RATING_TENANT;
const NOW = '2026-06-02T00:00:00Z';
const CONSUMED_AT = '2026-06-02T00:00:00.000Z';
let days = 0;

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
  days += 1;
  return new Date(Date.UTC(2026, 11, days)).toISOString().slice(0, 10);
}

async function claimedRequest(tokenHash: Buffer): Promise<string> {
  return db.withTenant(A.company, async (tx) => {
    const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
    await claimRequest(tx, {
      tenant: A,
      requestId,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers: [A.employees[0]],
    });
    return requestId;
  });
}

it('two simultaneous consumes of one link produce one rating', async () => {
  const tokenHash = Buffer.alloc(32, 41);
  const requestId = await claimedRequest(tokenHash);
  const consumed = createGate();
  const hold = createGate();

  const first = db.withTenant(A.company, async (tx) => {
    const id = await consumeRequest(tx, { tenant: A, tokenHash, now: NOW });
    consumed.open();
    await hold.opened;
    const ratingId = await insertRating(tx, { tenant: A, requestId, stars: 5, now: NOW });
    await insertAttribution(tx, {
      tenant: A,
      requestId,
      ratingId,
      employeeId: A.employees[0],
      stars: 5,
      now: NOW,
    });
    return id;
  });

  await consumed.opened;
  const second = db.withTenant(A.company, (tx) =>
    consumeRequest(tx, { tenant: A, tokenHash, now: NOW }),
  );
  let failure: unknown;
  try {
    await waitForBlockedAppSession(owner);
  } catch (error) {
    failure = error;
  } finally {
    hold.open();
  }
  const [firstResult, secondResult] = await Promise.allSettled([first, second]);
  if (failure !== undefined) throw failure;
  if (firstResult.status !== 'fulfilled') throw firstResult.reason;
  if (secondResult.status !== 'fulfilled') throw secondResult.reason;
  expect(firstResult.value).toBe(requestId);
  expect(secondResult.value).toBeNull();

  const ratings = await owner`SELECT id FROM ratings WHERE request_id=${requestId}`;
  expect(ratings).toHaveLength(1);
  const attributions =
    await owner`SELECT id FROM rating_attributions WHERE request_id=${requestId}`;
  expect(attributions).toHaveLength(1);
  const request = await owner<{ consumed_at: Date; consume_xact_id: string }[]>`
    SELECT consumed_at, consume_xact_id FROM rating_requests WHERE id=${requestId}`;
  expect(request).toHaveLength(1);
  const consumedAt = request[0]?.consumed_at;
  expect(consumedAt).toBeInstanceOf(Date);
  expect((consumedAt as Date).toISOString()).toBe(CONSUMED_AT);
  expect(request[0]?.consume_xact_id).not.toBeNull();
});

it('a consume issued before the claim commits affects no row', async () => {
  const tokenHash = Buffer.alloc(32, 42);
  const claimed = createGate();
  const hold = createGate();

  const claim = db.withTenant(A.company, async (tx) => {
    const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
    await claimRequest(tx, {
      tenant: A,
      requestId,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers: [A.employees[0]],
    });
    claimed.open();
    await hold.opened;
    return requestId;
  });

  await claimed.opened;
  let early: string | null = null;
  let failure: unknown;
  try {
    early = await db.withTenant(A.company, (tx) =>
      consumeRequest(tx, { tenant: A, tokenHash, now: NOW }),
    );
  } catch (error) {
    failure = error;
  } finally {
    hold.open();
  }
  const requestId = await claim;
  if (failure !== undefined) throw failure;
  expect(early).toBeNull();

  const after = await db.withTenant(A.company, (tx) =>
    consumeRequest(tx, { tenant: A, tokenHash, now: NOW }),
  );
  expect(after).toBe(requestId);
  const request = await owner<{ consumed_at: Date }[]>`
    SELECT consumed_at FROM rating_requests WHERE id=${requestId}`;
  expect(request).toHaveLength(1);
  expect(request[0]?.consumed_at).toBeInstanceOf(Date);
});

it('savepoints keep the transaction proof of the claim and of the consume', async () => {
  const tokenHash = Buffer.alloc(32, 43);
  const requestId = await db.withTenant(A.company, async (tx) => {
    const id = await insertRequest(tx, { tenant: A, date: nextDate() });
    await claimRequest(tx, {
      tenant: A,
      requestId: id,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers: [],
    });
    await tx.execute(sql`SAVEPOINT p1`);
    await insertPerformer(tx, { tenant: A, requestId: id, employeeId: A.employees[0] });
    await tx.execute(sql`SAVEPOINT p2`);
    // الـ driver بيعمل rollback للمعاملة كلها لو statement فشل جوّاها، فالفشل بيتحبس في scope متداخل.
    await expectPgError(
      tx.transaction(async (sp) => {
        await insertPerformer(sp, { tenant: A, requestId: id, employeeId: A.employees[0] });
      }),
      '23505',
      'rating_performers_request_employee_key',
    );
    await tx.execute(sql`ROLLBACK TO SAVEPOINT p2`);
    await insertPerformer(tx, { tenant: A, requestId: id, employeeId: A.employees[1] });
    return id;
  });

  const performers = await owner`SELECT employee_id FROM rating_performers
    WHERE request_id=${requestId} ORDER BY employee_id`;
  expect(performers).toHaveLength(2);
  const claimed = await owner`SELECT status FROM rating_requests WHERE id=${requestId}`;
  expect(claimed).toEqual([{ status: 'SENDING' }]);

  const ratingId = await db.withTenant(A.company, async (tx) => {
    const consumed = await consumeRequest(tx, { tenant: A, tokenHash, now: NOW });
    expect(consumed).toBe(requestId);
    await tx.execute(sql`SAVEPOINT p3`);
    await insertRating(tx, { tenant: A, requestId, stars: 5, now: NOW });
    await tx.execute(sql`ROLLBACK TO SAVEPOINT p3`);
    const id = await insertRating(tx, { tenant: A, requestId, stars: 5, now: NOW });
    for (const employeeId of A.employees) {
      await insertAttribution(tx, {
        tenant: A,
        requestId,
        ratingId: id,
        employeeId,
        stars: 5,
        now: NOW,
      });
    }
    return id;
  });

  const ratings = await owner`SELECT id FROM ratings WHERE request_id=${requestId}`;
  expect(ratings).toHaveLength(1);
  const attributions = await owner`SELECT employee_id FROM rating_attributions
    WHERE rating_id=${ratingId} ORDER BY employee_id`;
  expect(attributions).toHaveLength(2);
});
