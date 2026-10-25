import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database, type Tx } from '../index.ts';
import {
  claimRequest,
  consumeAndRate,
  expectPgError,
  insertAttribution,
  insertPerformer,
  insertRating,
  insertRequest,
  RATING_TENANT,
  type RatingTenant,
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
  return new Date(Date.UTC(2026, 10, sequence)).toISOString().slice(0, 10);
}

async function claimed(
  performers: readonly string[] = A.employees,
): Promise<{ id: string; tokenHash: Buffer }> {
  const tokenHash = Buffer.alloc(32, (sequence % 200) + 1);
  const id = await db.withTenant(A.company, async (tx) => {
    const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
    await claimRequest(tx, {
      tenant: A,
      requestId,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers,
    });
    return requestId;
  });
  return { id, tokenHash };
}

function consumeRow(
  tx: Tx,
  tenant: RatingTenant,
  tokenHash: Buffer,
  now: Date | string,
): Promise<Record<string, unknown>[]> {
  return tx.execute<Record<string, unknown>>(sql`UPDATE rating_requests SET consumed_at=${now}
    WHERE company_id=${tenant.company} AND token_hash=${tokenHash}
      AND consumed_at IS NULL AND expires_at>${now} RETURNING id`);
}

it('accepts snapshot rows in the claiming transaction and refuses them later', async () => {
  const { id } = await claimed();
  expect(await owner`SELECT id FROM rating_performers WHERE request_id=${id}`).toHaveLength(2);
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertPerformer(tx, { tenant: A, requestId: id, employeeId: A.employees[0] }),
    ),
    '23514',
    'rating_performers_claim_only',
  );
});

it('refuses performers before a claim and duplicate performers inside it', async () => {
  const id = await db.withTenant(A.company, (tx) =>
    insertRequest(tx, { tenant: A, date: nextDate() }),
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertPerformer(tx, { tenant: A, requestId: id, employeeId: A.employees[0] }),
    ),
    '23514',
    'rating_performers_claim_only',
  );
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      await claimRequest(tx, {
        tenant: A,
        requestId,
        tokenHash: Buffer.alloc(32, 211),
        readyEventId: ids.newId(),
        now: NOW,
        performers: [A.employees[0], A.employees[0]],
      });
    }),
    '23505',
    'rating_performers_request_employee_key',
  );
});

it('commits consume, rating and all attributions together', async () => {
  const { id, tokenHash } = await claimed();
  const ratingId = await db.withTenant(A.company, (tx) =>
    consumeAndRate(tx, {
      tenant: A,
      requestId: id,
      tokenHash,
      now: NOW,
      stars: 4,
      attribute: A.employees,
    }),
  );
  expect(ratingId).not.toBeNull();
  expect(await owner`SELECT id FROM rating_attributions WHERE rating_id=${ratingId}`).toHaveLength(
    2,
  );
});

it('rolls back the consumption, the rating and its attributions when the transaction fails', async () => {
  const { id, tokenHash } = await claimed();
  await expect(
    db.withTenant(A.company, async (tx) => {
      const consumed = await consumeRow(tx, A, tokenHash, NOW);
      expect(consumed).toHaveLength(1);
      const ratingId = await insertRating(tx, { tenant: A, requestId: id, stars: 5, now: NOW });
      await insertAttribution(tx, {
        tenant: A,
        requestId: id,
        ratingId,
        employeeId: A.employees[0],
        stars: 5,
        now: NOW,
      });
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  expect(await owner`SELECT consumed_at FROM rating_requests WHERE id=${id}`).toEqual([
    { consumed_at: null },
  ]);
  expect(await owner`SELECT id FROM ratings WHERE request_id=${id}`).toEqual([]);
  expect(await owner`SELECT id FROM rating_attributions WHERE request_id=${id}`).toEqual([]);
  const later = await db.withTenant(A.company, (tx) => consumeRow(tx, A, tokenHash, NOW));
  expect(later).toHaveLength(1);
});

it('refuses a rating outside the consuming transaction or after an earlier consume', async () => {
  const first = await claimed([A.employees[0]]);
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertRating(tx, { tenant: A, requestId: first.id, stars: 5, now: NOW }),
    ),
    '23514',
    'ratings_consume_only',
  );
  await db.withTenant(A.company, (tx) =>
    consumeAndRate(tx, {
      tenant: A,
      requestId: first.id,
      tokenHash: first.tokenHash,
      now: NOW,
      stars: 5,
      attribute: [A.employees[0]],
    }),
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertRating(tx, { tenant: A, requestId: first.id, stars: 5, now: NOW }),
    ),
    '23514',
    'ratings_consume_only',
  );
});

it('refuses an attribution outside the consuming transaction', async () => {
  const { id, tokenHash } = await claimed();
  const ratingId = await db.withTenant(A.company, (tx) =>
    consumeAndRate(tx, {
      tenant: A,
      requestId: id,
      tokenHash,
      now: NOW,
      stars: 5,
      attribute: A.employees,
    }),
  );
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      insertAttribution(tx, {
        tenant: A,
        requestId: id,
        ratingId: ratingId as string,
        employeeId: A.employees[0],
        stars: 5,
        now: NOW,
      }),
    ),
    '23514',
    'rating_attributions_consume_only',
  );
});

it('uses the one-rating key behind the transaction proof', async () => {
  const { id, tokenHash } = await claimed([A.employees[0]]);
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      await consumeRow(tx, A, tokenHash, NOW);
      await insertRating(tx, { tenant: A, requestId: id, stars: 5, now: NOW });
      await insertRating(tx, { tenant: A, requestId: id, stars: 5, now: NOW });
    }),
    '23505',
    'ratings_request_key',
  );
});

it('requires every snapshotted performer at commit and accepts a complete set', async () => {
  const incomplete = await claimed();
  await expectPgError(
    db.withTenant(A.company, (tx) =>
      consumeAndRate(tx, {
        tenant: A,
        requestId: incomplete.id,
        tokenHash: incomplete.tokenHash,
        now: NOW,
        stars: 3,
        attribute: [A.employees[0]],
      }),
    ),
    '23514',
    'ratings_attributions_complete',
  );
  expect(await owner`SELECT consumed_at FROM rating_requests WHERE id=${incomplete.id}`).toEqual([
    { consumed_at: null },
  ]);
  const complete = await claimed();
  await db.withTenant(A.company, (tx) =>
    consumeAndRate(tx, {
      tenant: A,
      requestId: complete.id,
      tokenHash: complete.tokenHash,
      now: NOW,
      stars: 3,
      attribute: A.employees,
    }),
  );
});

it('makes the second sequential consume affect zero rows', async () => {
  const { tokenHash } = await claimed([A.employees[0]]);
  const counts = await db.withTenant(A.company, async (tx) => {
    const first = await consumeRow(tx, A, tokenHash, NOW);
    const second = await consumeRow(tx, A, tokenHash, NOW);
    return [first.length, second.length];
  });
  expect(counts).toEqual([1, 0]);
});

it('treats expiry equality as expired and one millisecond before as valid', async () => {
  const expired = await claimed([A.employees[0]]);
  const valid = await claimed([A.employees[0]]);
  const counts = await db.withTenant(A.company, async (tx) => {
    const atExpiry = await consumeRow(tx, A, expired.tokenHash, '2026-06-09T00:00:00Z');
    const beforeExpiry = await consumeRow(tx, A, valid.tokenHash, '2026-06-08T23:59:59.999Z');
    return [atExpiry.length, beforeExpiry.length];
  });
  expect(counts).toEqual([0, 1]);
});

it('keeps the hash available for opt-out after consumption', async () => {
  const { id, tokenHash } = await claimed([A.employees[0]]);
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
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute(
      sql`SELECT id FROM rating_requests WHERE company_id=${A.company} AND token_hash=${tokenHash}`,
    ),
  );
  expect(rows).toEqual([{ id }]);
});

it('keeps equal hashes tenant-local during lookup and uniqueness checks', async () => {
  const { tokenHash } = await claimed([A.employees[0]]);
  expect(
    await db.withTenant(B.company, (tx) =>
      tx.execute(sql`SELECT id FROM rating_requests WHERE token_hash=${tokenHash}`),
    ),
  ).toEqual([]);
  const requestId = await db.withTenant(B.company, async (tx) => {
    const id = await insertRequest(tx, { tenant: B, date: '2026-11-30' });
    await claimRequest(tx, {
      tenant: B,
      requestId: id,
      tokenHash,
      readyEventId: ids.newId(),
      now: NOW,
      performers: [B.employees[0]],
    });
    return id;
  });
  expect(requestId).not.toBe('');
});
