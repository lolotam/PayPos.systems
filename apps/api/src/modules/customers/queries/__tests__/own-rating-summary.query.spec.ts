import type { StaffColumnCode } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  claimRequest,
  consumeRequest,
  insertAttribution,
  insertRating,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../../../../../../packages/db/test/rating-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { ownRatingSummaryStatement, readOwnRatingSummary } from '../own-rating-summary.query.ts';
import type { OwnRatingContext, OwnRatingReads } from '../own-rating-context.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const employeeId = A.employees[0];
const context: OwnRatingContext = {
  companyId: A.company,
  businessId: A.business,
  userId: '01920000-0000-7000-8000-0000000000f1',
};
let currentTimeZone = 'Asia/Kuwait';
let allowed = true;
const reads: OwnRatingReads = {
  context: async () => ({ employeeId, timeZone: currentTimeZone }),
  allowed: async () => new Set<StaffColumnCode>(allowed ? ['rating_average'] : []),
};

let visit = 0;
async function seedStars(
  rows: { stars: number; at: Date }[],
  options: { employeeId?: string; tenant?: RatingTenant } = {},
) {
  const tenant = options.tenant ?? A;
  const subject = options.employeeId ?? employeeId;
  for (const row of rows) {
    visit += 1;
    await db.withTenant(tenant.company, async (tx) => {
      const tokenHash = randomBytes(32);
      const customerId = ids.newId();
      await tx.execute(sql`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
        VALUES (${tenant.company},${customerId},'Synthetic rater customer',${'+1777' + String(visit).padStart(7, '0')},'ar',now(),now())`);
      const requestId = await insertRequest(tx, {
        tenant,
        customer: customerId,
        date: '2026-06-15',
      });
      await claimRequest(tx, {
        tenant,
        requestId,
        tokenHash,
        readyEventId: ids.newId(),
        now: '2026-06-01T00:00:00Z',
        performers: [subject],
      });
      await consumeRequest(tx, { tenant, tokenHash, now: '2026-06-02T09:00:00Z' });
      const ratingId = await insertRating(tx, {
        tenant,
        requestId,
        stars: row.stars,
        now: row.at,
      });
      await insertAttribution(tx, {
        tenant,
        requestId,
        ratingId,
        employeeId: subject,
        stars: row.stars,
        now: row.at,
      });
    });
  }
}
const at = (month: number, day: number, hour: number) =>
  new Date(Date.UTC(2026, month - 1, day, hour));
const summary = async (now: Date, sessionTimeZone?: string) =>
  db.withTenant(A.company, async (tx) => {
    if (sessionTimeZone !== undefined)
      await tx.execute(sql`SELECT set_config('timezone', ${sessionTimeZone}, true)`);
    return readOwnRatingSummary(tx, context, {}, now, reads);
  });

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user"(id,name,email) VALUES (${context.userId},'Synthetic rater','rater@example.test')
  ON CONFLICT (id) DO NOTHING`;
  await owner`UPDATE employees SET user_id=${context.userId} WHERE company_id=${A.company} AND id=${employeeId}`;
  await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${A.company},${ids.newId()},${A.business},${employeeId},${A.branch},'2026-01-01')`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
  await testDb.drop();
});

it('returns the exact HIDDEN shape without reading ratings', async () => {
  await seedStars([{ stars: 5, at: at(1, 2, 9) }]);
  allowed = false;
  try {
    expect(await summary(at(1, 15, 12))).toEqual({ visibility: 'HIDDEN' });
  } finally {
    allowed = true;
  }
});

it.each([
  { month: 2, stars: [4, 5], average: '4.5', count: 2 },
  { month: 4, stars: [5, 4, 4, 4], average: '4.3', count: 4 },
  { month: 5, stars: [5], average: '5.0', count: 1 },
])('rounds $average half up from $count ratings', async ({ month, stars, average, count }) => {
  await seedStars(stars.map((value) => ({ stars: value, at: at(month, 15, 12) })));
  expect(await summary(at(month, 20, 12))).toEqual({
    visibility: 'VISIBLE',
    average,
    count,
  });
});

it('answers null average with count zero when the month has no ratings', async () => {
  expect(await summary(at(8, 15, 12))).toEqual({
    visibility: 'VISIBLE',
    average: null,
    count: 0,
  });
});

it.each([
  {
    name: 'Asia/Kuwait June boundaries',
    timeZone: 'Asia/Kuwait',
    now: at(6, 15, 12),
    excluded: new Date('2026-05-31T20:59:59Z'),
    first: new Date('2026-05-31T21:00:00Z'),
    last: new Date('2026-06-30T20:59:59Z'),
    nextMonth: new Date('2026-06-30T21:00:00Z'),
  },
  {
    name: 'America/New_York March DST start',
    timeZone: 'America/New_York',
    now: at(3, 15, 12),
    excluded: new Date('2026-03-01T04:59:59Z'),
    first: new Date('2026-03-01T05:00:00Z'),
    last: new Date('2026-04-01T03:59:59Z'),
    nextMonth: new Date('2026-04-01T04:00:00Z'),
  },
  {
    name: 'America/New_York November DST end',
    timeZone: 'America/New_York',
    now: at(11, 15, 12),
    excluded: new Date('2026-11-01T03:59:59Z'),
    first: new Date('2026-11-01T04:00:00Z'),
    last: new Date('2026-11-30T23:59:59Z'),
    nextMonth: new Date('2026-12-01T05:00:00Z'),
  },
])(
  'applies the half-open month window for $name',
  async ({ timeZone, now, excluded, first, last, nextMonth }) => {
    currentTimeZone = timeZone;
    try {
      await seedStars([
        { stars: 1, at: excluded },
        { stars: 5, at: first },
        { stars: 5, at: last },
      ]);
      expect(await summary(now)).toMatchObject({
        visibility: 'VISIBLE',
        average: '5.0',
        count: 2,
      });
      await seedStars([{ stars: 3, at: nextMonth }]);
      expect(await summary(now)).toMatchObject({
        visibility: 'VISIBLE',
        average: '5.0',
        count: 2,
      });
    } finally {
      currentTimeZone = 'Asia/Kuwait';
    }
  },
);

it('does not count another employee or another company', async () => {
  const month = at(8, 15, 12);
  await seedStars([{ stars: 4, at: month }], { employeeId: A.employees[1] });
  await seedStars([{ stars: 1, at: month }], {
    employeeId: B.employees[0],
    tenant: RATING_TENANT.B,
  });
  expect(await summary(month)).toEqual({ visibility: 'VISIBLE', average: null, count: 0 });
});

it('is independent of the database session timezone', async () => {
  const now = at(6, 15, 12);
  expect(await summary(now)).toEqual(await summary(now, 'America/New_York'));
});

it('uses rating_attributions_employee_idx', async () => {
  const now = at(6, 15, 12);
  await seedStars(
    Array.from({ length: 300 }, (_, index) => ({
      stars: (index % 5) + 1,
      at: at(6, 1, index % 24),
    })),
  );
  await owner`ANALYZE rating_attributions`;
  const plan = await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${ownRatingSummaryStatement(context, employeeId, now, 'Asia/Kuwait')}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('rating_attributions_employee_idx');
});
