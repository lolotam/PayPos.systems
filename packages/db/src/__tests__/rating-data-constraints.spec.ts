import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database, type Tx } from '../index.ts';
import {
  claimRequest,
  consumeRequest,
  expectPgError,
  insertAttribution,
  insertPerformer,
  insertRating,
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
const { A } = RATING_TENANT;
const NOW = '2026-06-02T00:00:00Z';
let days = 0;
let tokens = 0;

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
  return new Date(Date.UTC(2026, 8, days)).toISOString().slice(0, 10);
}

function nextTokenHash(): Buffer {
  tokens += 1;
  return Buffer.alloc(32, tokens);
}

// المطالبة والاستهلاك لازم يكونوا في نفس المعاملة، عشان تريجرز الإصدار والاستهلاك هما اللي بيفتحوا الباب.
async function claimAndConsume(
  tx: Tx,
  options: { requestId: string; tokenHash: Buffer; performers: readonly string[] },
): Promise<void> {
  await claimRequest(tx, {
    tenant: A,
    requestId: options.requestId,
    tokenHash: options.tokenHash,
    readyEventId: ids.newId(),
    now: NOW,
    performers: options.performers,
  });
  const consumed = await consumeRequest(tx, {
    tenant: A,
    tokenHash: options.tokenHash,
    now: NOW,
  });
  expect(consumed).toBe(options.requestId);
}

async function seedData(comment: string | null = null): Promise<{
  requestId: string;
  ratingId: string;
}> {
  return db.withTenant(A.company, async (tx) => {
    const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
    const tokenHash = nextTokenHash();
    await claimAndConsume(tx, { requestId, tokenHash, performers: [A.employees[0]] });
    const ratingId = await insertRating(tx, {
      tenant: A,
      requestId,
      stars: 5,
      comment,
      now: NOW,
    });
    await insertAttribution(tx, {
      tenant: A,
      requestId,
      ratingId,
      employeeId: A.employees[0],
      stars: 5,
      now: NOW,
    });
    return { requestId, ratingId };
  });
}

it('accepts a valid rating, snapshot and matching attribution', async () => {
  const data = await seedData('Synthetic comment');
  expect(
    await owner`SELECT id FROM rating_attributions WHERE rating_id=${data.ratingId}`,
  ).toHaveLength(1);
});

it('refuses a performer from another business', async () => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = nextTokenHash();
      await claimRequest(tx, {
        tenant: A,
        requestId,
        tokenHash,
        readyEventId: ids.newId(),
        now: NOW,
        performers: [A.employees[0]],
      });
      await insertPerformer(tx, {
        tenant: A,
        requestId,
        employeeId: OTHER_RATING_BUSINESS.employee,
        business: A.business,
      });
    }),
    '23503',
    'rating_performers_employee_fk',
  );
});

it('refuses a rating branch different from its request branch', async () => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = nextTokenHash();
      await claimAndConsume(tx, { requestId, tokenHash, performers: [A.employees[0]] });
      await insertRating(tx, {
        tenant: A,
        requestId,
        branch: OTHER_RATING_BUSINESS.branch,
        stars: 5,
        now: NOW,
      });
    }),
    '23503',
    'ratings_request_fk',
  );
});

it('refuses attribution to an employee absent from the snapshot', async () => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = nextTokenHash();
      await claimAndConsume(tx, { requestId, tokenHash, performers: [A.employees[0]] });
      const ratingId = await insertRating(tx, { tenant: A, requestId, stars: 5, now: NOW });
      await insertAttribution(tx, {
        tenant: A,
        requestId,
        ratingId,
        employeeId: A.employees[1],
        stars: 5,
        now: NOW,
      });
    }),
    '23503',
    'rating_attributions_performer_fk',
  );
});

it('refuses attribution stars different from the rating', async () => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = nextTokenHash();
      await claimAndConsume(tx, { requestId, tokenHash, performers: [A.employees[0]] });
      const ratingId = await insertRating(tx, { tenant: A, requestId, stars: 5, now: NOW });
      await insertAttribution(tx, {
        tenant: A,
        requestId,
        ratingId,
        employeeId: A.employees[0],
        stars: 4,
        now: NOW,
      });
    }),
    '23503',
    'rating_attributions_rating_fk',
  );
});

it.each([0, 6])('refuses %s stars on a rating', async (stars) => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = nextTokenHash();
      await claimAndConsume(tx, { requestId, tokenHash, performers: [A.employees[0]] });
      await insertRating(tx, { tenant: A, requestId, stars, now: NOW });
    }),
    '23514',
    'ratings_stars',
  );
});

it.each([0, 6])('refuses %s stars on an attribution', async (stars) => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = nextTokenHash();
      await claimAndConsume(tx, { requestId, tokenHash, performers: [A.employees[0]] });
      const ratingId = await insertRating(tx, { tenant: A, requestId, stars: 5, now: NOW });
      await insertAttribution(tx, {
        tenant: A,
        requestId,
        ratingId,
        employeeId: A.employees[0],
        stars,
        now: NOW,
      });
    }),
    '23514',
    'rating_attributions_stars',
  );
});

it.each([
  ['Arabic', 'ت'],
  ['astral', '😀'],
])('accepts a 1000-code-point %s comment', async (_label, character) => {
  const data = await seedData(character.repeat(1000));
  const rows = await owner<
    { comment: string }[]
  >`SELECT comment FROM ratings WHERE id=${data.ratingId}`;
  expect(Array.from(rows[0]?.comment ?? '')).toHaveLength(1000);
});

it('refuses a 1001-code-point comment', async () => {
  await expectPgError(
    db.withTenant(A.company, async (tx) => {
      const requestId = await insertRequest(tx, { tenant: A, date: nextDate() });
      const tokenHash = nextTokenHash();
      await claimAndConsume(tx, { requestId, tokenHash, performers: [A.employees[0]] });
      await insertRating(tx, {
        tenant: A,
        requestId,
        stars: 5,
        comment: 'ت'.repeat(1001),
        now: NOW,
      });
    }),
    '23514',
    'ratings_comment_length',
  );
});
