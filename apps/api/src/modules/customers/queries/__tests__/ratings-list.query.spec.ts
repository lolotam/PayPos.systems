import { ratingsListPage, type RatingsListPage } from '@pospay/contracts';
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
import { seedRating } from './ratings-list.fixture.ts';
import { ratingsListStatement, readRatingsList } from '../ratings-list.query.ts';
import type { RatingsListReads, RatingsListScope } from '../ratings-list-reads.ts';
import { monthPeriod } from '../ratings-period.query.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = RATING_TENANT;
const [sara, hend] = A.employees;
const second = '01920000-0000-7000-8000-000000000a93';
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));
const context: RatingsListScope = {
  companyId: A.company,
  businessId: A.business,
  userId: ids.newId(),
};
const everything: readonly string[] = [A.branch, second];
let access = everything;
let zone = 'Asia/Kuwait';
const requestedNames: string[][] = [];
const reads: RatingsListReads = {
  access: async () => access,
  branchNames: async () =>
    new Map([
      [A.branch, { name_ar: 'السالمية', name_en: 'Salmiya' }],
      [second, { name_ar: null, name_en: 'Hawalli' }],
    ]),
  timeZone: async () => zone,
  employeeNames: async (_tx, _company, employeeIds) => {
    requestedNames.push([...employeeIds]);
    return new Map([
      [sara, { name_ar: 'سارة', name_en: 'Sara' }],
      [hend, { name_ar: null, name_en: 'Hend' }],
    ]);
  },
};
const page = (query: object = {}, scope = context) =>
  db.withTenant(scope.companyId, (tx) => readRatingsList(tx, scope, query, new Date(), reads), {
    readOnly: true,
  });
const idsOf = (result: RatingsListPage) => result.items.map((item) => item.id);
const refusal = (run: Promise<unknown>) =>
  run.then(
    () => 'accepted',
    (error: unknown) => (error instanceof ApiError ? error.code : 'other'),
  );

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

it('returns stars, instants, business date, branch, performers and the comment exactly as written', async () => {
  const comment = 'Great <b>service</b>, call 55512345 https://example.test';
  const rating = await seedRating(db, A, {
    stars: 2,
    at: new Date('2026-06-10T09:30:15.123Z'),
    performers: [hend, sara],
    comment,
    date: '2026-06-10',
  });
  const result = await page({ from: '2026-06-10T00:00:00Z', to: '2026-06-11T00:00:00Z' });
  expect(ratingsListPage.parse(result)).toEqual(result);
  expect(result).toEqual({
    items: [
      {
        id: rating,
        stars: 2,
        submitted_at: '2026-06-10T09:30:15.123000Z',
        business_date: '2026-06-10',
        branch: { id: A.branch, name_ar: 'السالمية', name_en: 'Salmiya' },
        performers: [sara, hend].sort().map((employee_id) => ({
          employee_id,
          name_ar: employee_id === sara ? 'سارة' : null,
          name_en: employee_id === sara ? 'Sara' : 'Hend',
        })),
        comment,
      },
    ],
    next_cursor: null,
    month: null,
  });
});

it('resolves the names of the page performers only, in one read', async () => {
  await seedRating(db, A, { stars: 3, at: at(8), performers: [hend, sara] });
  requestedNames.length = 0;
  await page({ from: at(8, 0).toISOString(), to: at(9, 0).toISOString() });
  expect(requestedNames).toHaveLength(1);
  expect([...(requestedNames[0] ?? [])].sort()).toEqual([sara, hend].sort());
  requestedNames.length = 0;
  await page({ branch_id: second, from: '2026-07-01T00:00:00Z' });
  expect(requestedNames).toEqual([[]]);
});

it('pages newest first without a duplicate or a gap when ratings share a submitted_at', async () => {
  const tied: string[] = [];
  for (let n = 0; n < 5; n += 1)
    tied.push(
      await seedRating(db, A, { stars: 3, at: at(20), performers: [sara], date: '2026-06-20' }),
    );
  const newest = await seedRating(db, A, { stars: 4, at: at(21), performers: [sara] });
  const oldest = await seedRating(db, A, { stars: 4, at: at(19), performers: [sara] });
  const window = { from: at(19).toISOString(), to: at(22).toISOString() };
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const next: RatingsListPage = await page({
      ...window,
      limit: 2,
      ...(cursor === undefined ? {} : { cursor }),
    });
    expect(next.items.length).toBeLessThanOrEqual(2);
    seen.push(...idsOf(next));
    cursor = next.next_cursor ?? undefined;
  } while (cursor !== undefined);
  expect(seen).toEqual([newest, ...[...tied].sort().reverse(), oldest]);
});

it('narrows by branch, employee and the half-open time window', async () => {
  const hawalli = await seedRating(db, A, {
    stars: 5,
    at: at(5),
    performers: [hend],
    branch: second,
  });
  expect(idsOf(await page({ branch_id: second }))).toEqual([hawalli]);
  const day = { from: at(5).toISOString(), to: at(6).toISOString() };
  expect(idsOf(await page({ employee_id: hend, ...day }))).toEqual([hawalli]);
  expect(idsOf(await page({ employee_id: hend, to: at(5).toISOString() }))).not.toContain(hawalli);
  expect(idsOf(await page({ from: at(5, 13).toISOString(), to: at(6).toISOString() }))).toEqual([]);
});

it('never returns a branch outside the scope, with or without the branch filter', async () => {
  access = [A.branch];
  try {
    const rated = await seedRating(db, A, { stars: 4, at: at(9), performers: [sara] });
    const all = await page({ limit: 100 });
    expect(all.items.length).toBeGreaterThan(0);
    expect(idsOf(all)).toContain(rated);
    expect(all.items.every((item) => item.branch.id === A.branch)).toBe(true);
    expect(all.items.some((item) => item.branch.id === second)).toBe(false);
    expect(await page({ branch_id: second })).toEqual({
      items: [],
      next_cursor: null,
      month: null,
    });
  } finally {
    access = everything;
  }
});

it('refuses with FORBIDDEN when no branch is readable', async () => {
  access = [];
  try {
    expect(await refusal(page())).toBe('FORBIDDEN');
  } finally {
    access = everything;
  }
});

it('returns nothing of another tenant, even when the business id belongs to it', async () => {
  const foreign = await seedRating(db, B, { stars: 1, at: at(12), performers: [B.employees[0]] });
  const empty = { items: [], next_cursor: null, month: null };
  expect(await page({}, { ...context, businessId: B.business })).toEqual(empty);
  expect(idsOf(await page({ limit: 100 }))).not.toContain(foreign);
});

it('rejects a malformed cursor and an unknown key uniformly', async () => {
  expect(await refusal(page({ cursor: 'not-a-cursor' }))).toBe('BAD_REQUEST');
  const forged = Buffer.from(JSON.stringify({ at: 'x', id: 'y' })).toString('base64url');
  expect(await refusal(page({ cursor: forged }))).toBe('BAD_REQUEST');
  expect(await refusal(page({ business_id: B.business }))).toBe('VALIDATION_FAILED');
});

it('rejects a malformed cursor the same way when the requested branch is outside the reader scope', async () => {
  const outside = { branch_id: B.branch };
  expect(await refusal(page({ ...outside, cursor: 'not-a-cursor' }))).toBe('BAD_REQUEST');
  const forged = Buffer.from(JSON.stringify({ at: 'x', id: 'y' })).toString('base64url');
  expect(await refusal(page({ ...outside, cursor: forged }))).toBe('BAD_REQUEST');
  expect(await page(outside)).toEqual({ items: [], next_cursor: null, month: null });
});

// خطة كل تركيبة فلتر بتتثبت بخصائص مش بأسماء فهارس على فيكستشر صغير: مفيش Seq Scan على الجدولين الكبار، وكل مسح بيبدأ من
// الفهرس بشرط الشركة والنشاط/الموظف وحد المؤشر على submitted_at، وصفوف التقييمات المقروءة بحجم الصفحة مش بحجم النشاط.
// قياس الـ 50,000 تقييم (61-remaining/plan.md §6) اتعمل خارج الـ repo ونتيجته في تقرير 61-2b.
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Cond'?: string;
  'Actual Rows': number;
  Plans?: PlanNode[];
}
const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
const LIMIT = 5;
const explain = (filter: Partial<Parameters<typeof ratingsListStatement>[0]>) =>
  db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    await tx.execute(sql`SET LOCAL enable_bitmapscan=off`);
    const statement = ratingsListStatement({
      companyId: A.company,
      businessId: A.business,
      branchIds: [A.branch, second],
      period: { kind: 'range' },
      cursor: null,
      limit: LIMIT,
      ...filter,
    });
    const [row] = Array.from(await tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`));
    const plan = row?.['QUERY PLAN'];
    const parsed = (typeof plan === 'string' ? JSON.parse(plan) : plan) as { Plan: PlanNode }[];
    return flatten((parsed[0] as { Plan: PlanNode }).Plan).filter((n) =>
      ['ratings', 'rating_attributions'].includes(n['Relation Name'] ?? ''),
    );
  });

it(
  'keeps each filter combination on index conditions bounded by the page',
  { timeout: 120_000 },
  async () => {
    for (let n = 0; n < 60; n += 1)
      await seedRating(db, A, {
        stars: (n % 5) + 1,
        at: at(1 + (n % 28), n % 24),
        performers: [n % 3 === 0 ? hend : sara],
        branch: n % 2 === 0 ? second : A.branch,
      });
    await owner`ANALYZE ratings`;
    await owner`ANALYZE rating_attributions`;
    const cursor = { at: at(15).toISOString(), id: '01920000-0000-7000-8000-0000000000ff' };
    const combos: Record<string, Partial<Parameters<typeof ratingsListStatement>[0]>> = {
      businessWide: {},
      oneBranch: { branchIds: [A.branch] },
      wideEmployee: { employeeId: hend },
      monthWindow: { period: monthPeriod('Asia/Kuwait', '2026-06', new Date()) },
      branchEmployee: { branchIds: [second], employeeId: hend },
    };
    for (const [name, filter] of Object.entries(combos))
      for (const after of [null, cursor]) {
        const scans = await explain({ ...filter, cursor: after });
        const label = `${name} ${after === null ? 'first' : 'cursor'}`;
        expect(scans.length, label).toBeGreaterThan(0);
        if (after !== null)
          expect(
            scans.some((n) => n['Index Cond']?.includes('submitted_at <=')),
            label,
          ).toBe(true);
        for (const scan of scans) {
          expect(scan['Node Type'], label).toMatch(/^Index (Only )?Scan( Backward)?$/);
          expect(scan['Index Cond'], label).toContain('company_id');
          if (scan['Relation Name'] === 'ratings' && !('employeeId' in filter))
            expect(scan['Actual Rows'], label).toBeLessThanOrEqual(LIMIT + 2);
        }
      }
  },
);

it('binds the window bounds with their microseconds and accepts a range inside one millisecond (F4)', async () => {
  const rating = await seedRating(db, A, {
    stars: 3,
    at: new Date('2026-07-01T12:00:00.123Z'),
    performers: [sara],
    date: '2026-07-01',
  });
  const within = async (from: string, to: string) => idsOf(await page({ from, to }));
  const edge = '2026-07-01T12:00:00';
  expect(await within(`${edge}.123001Z`, `${edge}.123999Z`)).toEqual([]);
  expect(await within(`${edge}.122999Z`, `${edge}.123001Z`)).toEqual([rating]);
  expect(await within(`${edge}.122001Z`, `${edge}.122999Z`)).toEqual([]);
  expect(await within(`${edge}.122999Z`, `${edge}.123000Z`)).toEqual([]);
  expect(await within(`${edge}.123000Z`, `${edge}.123001Z`)).toEqual([rating]);
  expect(await refusal(page({ from: `${edge}.123001Z`, to: `${edge}.123001Z` }))).toBe(
    'VALIDATION_FAILED',
  );
  expect(await refusal(page({ from: `${edge}.123999Z`, to: `${edge}.123001Z` }))).toBe(
    'VALIDATION_FAILED',
  );
});

it('month lists that calendar month of the business zone and the cursor stays valid across its pages', async () => {
  const kept = [
    await seedRating(db, A, { stars: 3, at: new Date('2027-03-31T20:30:00Z'), performers: [sara] }),
    await seedRating(db, A, { stars: 3, at: new Date('2027-03-10T09:00:00Z'), performers: [sara] }),
    await seedRating(db, A, { stars: 3, at: new Date('2027-03-01T00:00:00Z'), performers: [sara] }),
  ];
  const next = await seedRating(db, A, {
    stars: 4,
    at: new Date('2027-03-31T21:30:00Z'),
    performers: [sara],
  });
  const march = await page({ month: '2027-03', limit: 1 });
  const seen: string[] = [];
  let cursor: string | null = march.next_cursor;
  seen.push(...idsOf(march));
  while (cursor !== null) {
    const following = await page({ month: '2027-03', limit: 1, cursor });
    seen.push(...idsOf(following));
    cursor = following.next_cursor;
  }
  expect(seen).toEqual([kept[0], kept[1], kept[2]]);
  expect(march.month).toBe('2027-03');
  expect(idsOf(await page({ month: '2027-04' }))).toEqual([next]);
  expect(await refusal(page({ month: '2027-03', from: '2027-03-01T00:00:00Z' }))).toBe(
    'VALIDATION_FAILED',
  );
});

it('lists the first occurrence of a repeated month-start hour in the month (America/Havana, November 2015: local midnight 00:00 occurs twice)', async () => {
  const rate = (stars: number, iso: string) =>
    seedRating(db, A, { stars, at: new Date(iso), performers: [sara] });
  await rate(1, '2015-11-01T03:59:00Z');
  const firstOccurrence = await rate(5, '2015-11-01T04:30:00Z');
  const secondOccurrence = await rate(4, '2015-11-01T05:30:00Z');
  const lastMinute = await rate(3, '2015-12-01T04:59:00Z');
  await rate(1, '2015-12-01T05:00:00Z');
  zone = 'America/Havana';
  try {
    expect(idsOf(await page({ month: '2015-11' }))).toEqual([
      lastMinute,
      secondOccurrence,
      firstOccurrence,
    ]);
  } finally {
    zone = 'Asia/Kuwait';
  }
});
