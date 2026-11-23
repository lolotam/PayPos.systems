import { ratingAverages, type RatingAverages } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  RATING_TENANT,
  seedRatingTenants,
} from '../../../../../../../packages/db/test/rating-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { ApiError } from '../../../../shared/errors.ts';
import { ratingAveragesStatement, readRatingAverages } from '../rating-averages.query.ts';
import { monthPeriod } from '../ratings-period.query.ts';
import type { RatingsListReads, RatingsListScope } from '../ratings-list-reads.ts';
import { seedRating } from './ratings-list.fixture.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const [sara, hend] = A.employees;
const second = '01920000-0000-7000-8000-000000000a94';
const NOW = new Date('2026-06-15T12:00:00Z');
const context: RatingsListScope = {
  companyId: A.company,
  businessId: A.business,
  userId: ids.newId(),
};
const everything: readonly string[] = [A.branch, second];
let access = everything;
let zone: string | null = 'Asia/Kuwait';
const reads: RatingsListReads = {
  access: async () => access,
  branchNames: async () => new Map(),
  timeZone: async () => zone,
  employeeNames: async () =>
    new Map([
      [sara, { name_ar: 'سارة', name_en: 'Sara' }],
      [hend, { name_ar: null, name_en: 'Hend' }],
    ]),
};
const averages = (query: object = {}, scope = context, now = NOW) =>
  db.withTenant(scope.companyId, (tx) => readRatingAverages(tx, scope, query, now, reads), {
    readOnly: true,
  });
const summary = (result: RatingAverages) =>
  result.items.map((item) => [item.employee_id, item.average, item.count]);
const refusal = (run: Promise<unknown>) =>
  run.then(
    () => 'accepted',
    (error: unknown) => (error instanceof ApiError ? error.code : 'other'),
  );
const june = { from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' };
const rate = (stars: number, iso: string, performers: readonly string[], branch?: string) =>
  seedRating(db, A, { stars, at: new Date(iso), performers, ...(branch ? { branch } : {}) });

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${A.company},${second},${A.business},'Hawalli')`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
  await testDb.drop();
});

it('counts a rating with two performers for both and averages only the ratings attributed to each (RT-24)', async () => {
  await rate(5, '2026-06-10T09:00:00Z', [sara, hend]);
  await rate(4, '2026-06-11T09:00:00Z', [sara]);
  const result = await averages(june);
  expect(ratingAverages.parse(result)).toEqual(result);
  expect(result).toEqual({
    items: [
      { employee_id: sara, name_ar: 'سارة', name_en: 'Sara', average: '4.5', count: 2 },
      { employee_id: hend, name_ar: null, name_en: 'Hend', average: '5.0', count: 1 },
    ],
    month: null,
  });
});

it('rounds half up to one decimal in SQL and returns a string', async () => {
  for (const stars of [5, 4, 4, 4]) await rate(stars, '2026-04-10T09:00:00Z', [hend]);
  await rate(3, '2026-05-10T09:00:00Z', [sara]);
  await rate(2, '2026-05-11T09:00:00Z', [sara]);
  const april = { from: '2026-04-01T00:00:00Z', to: '2026-05-01T00:00:00Z' };
  expect(summary(await averages(april))).toEqual([[hend, '4.3', 4]]);
  const may = { from: '2026-05-01T00:00:00Z', to: '2026-06-01T00:00:00Z' };
  expect(summary(await averages({ ...may, employee_id: sara }))).toEqual([[sara, '2.5', 2]]);
});

it('uses the current calendar month of the business time zone when from and to are absent', async () => {
  await rate(1, '2026-05-31T20:59:00Z', [hend]);
  await rate(2, '2026-05-31T21:00:00Z', [hend]);
  await rate(2, '2026-06-30T20:59:00Z', [hend]);
  await rate(1, '2026-06-30T21:00:00Z', [hend]);
  expect(summary(await averages({ employee_id: hend }))).toEqual([[hend, '3.0', 3]]);
  expect((await averages({ employee_id: hend })).month).toBe('2026-06');
  const july = await averages({ employee_id: hend }, context, new Date('2026-07-15T00:00:00Z'));
  expect(summary(july)).toEqual([[hend, '1.0', 1]]);
  expect(july.month).toBe('2026-07');
  // الشهر المسمّى هو شهر توقيت النشاط: 21:30 UTC آخر يوم في يونيو هو يوليو في الكويت وما زال يونيو في UTC.
  const edge = new Date('2026-06-30T21:30:00Z');
  expect((await averages({}, context, edge)).month).toBe('2026-07');
  expect((await averages({ month: '2026-01' })).month).toBe('2026-01');
  zone = 'UTC';
  try {
    expect(summary(await averages({ employee_id: hend }))).toEqual([[hend, '2.7', 3]]);
  } finally {
    zone = 'Asia/Kuwait';
  }
});

it('treats to as exclusive, and leaves the other end open when only one bound is sent', async () => {
  const day = { from: '2026-06-10T09:00:00Z', to: '2026-06-11T09:00:00Z' };
  expect(summary(await averages(day))).toEqual([
    [sara, '5.0', 1],
    [hend, '5.0', 1],
  ]);
  const empty = { from: '2026-06-11T09:00:01Z', to: '2026-06-11T09:00:02Z' };
  expect((await averages(empty)).items).toEqual([]);
  const open = await averages({ from: '2026-06-11T09:00:00Z', employee_id: sara });
  expect(summary(open)).toEqual([[sara, '4.0', 1]]);
});

it('never counts a branch outside the scope, with or without the branch filter', async () => {
  await rate(1, '2026-06-12T09:00:00Z', [sara], second);
  const window = { from: '2026-06-12T00:00:00Z', to: '2026-06-13T00:00:00Z' };
  expect(summary(await averages(window))).toEqual([[sara, '1.0', 1]]);
  expect(summary(await averages({ ...window, branch_id: second }))).toEqual([[sara, '1.0', 1]]);
  access = [A.branch];
  try {
    expect((await averages(window)).items).toEqual([]);
    expect((await averages({ ...window, branch_id: second })).items).toEqual([]);
    expect(summary(await averages(june))[0]).toEqual([sara, '4.5', 2]);
  } finally {
    access = everything;
  }
});

it('refuses with FORBIDDEN when no branch is readable and with VALIDATION_FAILED on a bad query', async () => {
  access = [];
  try {
    expect(await refusal(averages(june))).toBe('FORBIDDEN');
  } finally {
    access = everything;
  }
  expect(await refusal(averages({ business_id: B.business }))).toBe('VALIDATION_FAILED');
  expect(await refusal(averages({ from: june.to, to: june.from }))).toBe('VALIDATION_FAILED');
  expect(await refusal(averages({ limit: 5 }))).toBe('VALIDATION_FAILED');
});

it('returns nothing of another tenant, even when the business id belongs to it', async () => {
  await seedRating(db, B, {
    stars: 1,
    at: new Date('2026-04-02T09:00:00Z'),
    performers: [B.employees[0]],
  });
  expect(await averages(june, { ...context, businessId: B.business })).toEqual({
    items: [],
    month: null,
  });
  const april = { from: '2026-04-01T00:00:00Z', to: '2026-04-03T00:00:00Z' };
  expect(summary(await averages(april))).toEqual([]);
});

// الخطة بتتثبت بخصائص مش بأسماء فهارس: مفيش Seq Scan على rating_attributions، والمسح بالفهرس بشرط الشركة، وبحد زمن على
// submitted_at، وصفوف المسح ما بتزيدش عن صفوف النشاط في الفترة.
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Cond'?: string;
  'Actual Rows': number;
  Plans?: PlanNode[];
}
const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
const explain = (filter: Partial<Parameters<typeof ratingAveragesStatement>[0]>) =>
  db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    await tx.execute(sql`SET LOCAL enable_bitmapscan=off`);
    const statement = ratingAveragesStatement({
      companyId: A.company,
      businessId: A.business,
      branchIds: [A.branch, second],
      period: monthPeriod('Asia/Kuwait', undefined, NOW),
      ...filter,
    });
    const [row] = Array.from(await tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`));
    const plan = row?.['QUERY PLAN'];
    const parsed = (typeof plan === 'string' ? JSON.parse(plan) : plan) as { Plan: PlanNode }[];
    return flatten((parsed[0] as { Plan: PlanNode }).Plan).filter(
      (n) => n['Relation Name'] === 'rating_attributions',
    );
  });

it(
  'keeps every filter combination on an index scan bounded by company and time',
  { timeout: 120_000 },
  async () => {
    for (let n = 0; n < 60; n += 1)
      await rate(
        (n % 5) + 1,
        new Date(Date.UTC(2026, 0, 1 + (n % 28), n % 24)).toISOString(),
        [n % 3 === 0 ? hend : sara],
        n % 2 === 0 ? second : A.branch,
      );
    await owner`ANALYZE rating_attributions`;
    const [counted] = await owner`SELECT count(*)::int AS total FROM rating_attributions
      WHERE submitted_at >= '2026-01-01' AND submitted_at < '2026-02-01'`;
    const total = counted?.['total'] as number;
    const january = { from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' };
    const combos: Record<string, Partial<Parameters<typeof ratingAveragesStatement>[0]>> = {
      defaultMonth: {},
      window: { period: { kind: 'range', ...january } },
      oneBranch: { branchIds: [A.branch], period: { kind: 'range', from: january.from } },
      employee: { employeeId: hend, period: { kind: 'range', ...january } },
      monthParam: { period: monthPeriod('Asia/Kuwait', '2026-01', NOW) },
    };
    for (const [name, filter] of Object.entries(combos)) {
      const scans = await explain(filter);
      expect(scans.length, name).toBeGreaterThan(0);
      for (const scan of scans) {
        expect(scan['Node Type'], name).toMatch(/^Index (Only )?Scan( Backward)?$/);
        expect(scan['Index Cond'], name).toContain('company_id');
        expect(scan['Index Cond'], name).toContain('submitted_at');
        expect(scan['Actual Rows'], name).toBeLessThanOrEqual(total);
      }
    }
  },
);

it('binds the window bounds with their microseconds and accepts a range inside one millisecond (F4)', async () => {
  await rate(4, '2026-07-01T12:00:00.123Z', [sara]);
  const edge = '2026-07-01T12:00:00';
  const within = async (from: string, to: string) =>
    summary(await averages({ from, to, employee_id: sara }));
  expect(await within(`${edge}.123001Z`, `${edge}.123999Z`)).toEqual([]);
  expect(await within(`${edge}.122999Z`, `${edge}.123001Z`)).toEqual([[sara, '4.0', 1]]);
  expect(await within(`${edge}.122001Z`, `${edge}.122999Z`)).toEqual([]);
  expect(await within(`${edge}.122999Z`, `${edge}.123000Z`)).toEqual([]);
  expect(await refusal(averages({ from: `${edge}.123001Z`, to: `${edge}.123001Z` }))).toBe(
    'VALIDATION_FAILED',
  );
  expect(await refusal(averages({ from: `${edge}.123999Z`, to: `${edge}.123001Z` }))).toBe(
    'VALIDATION_FAILED',
  );
});

it('month selects that calendar month in the business time zone: 21:30 UTC on the last day of March is April in Kuwait', async () => {
  await rate(2, '2027-03-31T20:30:00Z', [sara]);
  await rate(5, '2027-03-31T21:30:00Z', [sara]);
  expect(summary(await averages({ month: '2027-03', employee_id: sara }))).toEqual([
    [sara, '2.0', 1],
  ]);
  expect(summary(await averages({ month: '2027-04', employee_id: sara }))).toEqual([
    [sara, '5.0', 1],
  ]);
  zone = 'UTC';
  try {
    expect(summary(await averages({ month: '2027-03', employee_id: sara }))).toEqual([
      [sara, '3.5', 2],
    ]);
  } finally {
    zone = 'Asia/Kuwait';
  }
});

it('keeps the first occurrence of a repeated month-start hour in the month (America/Havana, November 2015: local midnight 00:00 occurs twice)', async () => {
  await rate(1, '2015-11-01T03:59:00Z', [hend]);
  await rate(5, '2015-11-01T04:30:00Z', [hend]);
  await rate(4, '2015-11-01T05:30:00Z', [hend]);
  await rate(3, '2015-12-01T04:59:00Z', [hend]);
  await rate(1, '2015-12-01T05:00:00Z', [hend]);
  zone = 'America/Havana';
  try {
    const named = await averages({ month: '2015-11', employee_id: hend });
    expect(summary(named)).toEqual([[hend, '4.0', 3]]);
    const current = await averages(
      { employee_id: hend },
      context,
      new Date('2015-11-15T12:00:00Z'),
    );
    expect(summary(current)).toEqual([[hend, '4.0', 3]]);
    expect(summary(await averages({ month: '2015-12', employee_id: hend }))).toEqual([
      [hend, '1.0', 1],
    ]);
  } finally {
    zone = 'Asia/Kuwait';
  }
});

it('keeps the first instant of a month whose local midnight was skipped (America/Asuncion, October 2023)', async () => {
  await rate(1, '2023-10-01T03:59:00Z', [sara]);
  await rate(5, '2023-10-01T04:00:00Z', [sara]);
  await rate(3, '2023-11-01T02:59:00Z', [sara]);
  await rate(1, '2023-11-01T03:00:00Z', [sara]);
  zone = 'America/Asuncion';
  try {
    expect(summary(await averages({ month: '2023-10', employee_id: sara }))).toEqual([
      [sara, '4.0', 2],
    ]);
    expect(summary(await averages({ month: '2023-11', employee_id: sara }))).toEqual([
      [sara, '1.0', 1],
    ]);
  } finally {
    zone = 'Asia/Kuwait';
  }
});

it('refuses month with from or to, a malformed month, and reads the business zone only for a month window', async () => {
  expect(await refusal(averages({ month: '2026-06', from: june.from }))).toBe('VALIDATION_FAILED');
  expect(await refusal(averages({ month: '2026-06', to: june.to }))).toBe('VALIDATION_FAILED');
  expect(await refusal(averages({ month: '2026-6' }))).toBe('VALIDATION_FAILED');
  zone = null;
  try {
    expect(await refusal(averages({ month: '2026-06' }))).toBe('FORBIDDEN');
    expect(await refusal(averages({}))).toBe('FORBIDDEN');
    expect(await refusal(averages(june))).toBe('accepted');
  } finally {
    zone = 'Asia/Kuwait';
  }
});
