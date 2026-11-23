import { ratingsListPage, type RatingsListPage } from '@pospay/contracts';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
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
import { seedRating } from './ratings-list.fixture.ts';
import { readRatingsList } from '../ratings-list.query.ts';
import type { RatingsListReads, RatingsListScope } from '../ratings-list-reads.ts';

// فلتر الموظف مع نطاق أضيق من النشاط: تاريخ الموظفة في فرع خارج النطاق ممكن يتمسح ويتصفّى (تكلفة تنتظر فهرس موظف+فرع بهجرة)،
// لكن ما بيرجع منه صف ولا بيأثر على المؤشر، والمشي بالمؤشر بيوصل لآخر صفحة بلا تكرار.
let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A } = RATING_TENANT;
const [sara] = A.employees;
const outside = '01920000-0000-7000-8000-000000000a95';
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));
const context: RatingsListScope = {
  companyId: A.company,
  businessId: A.business,
  userId: ids.newId(),
};
let access: readonly string[] = [A.branch];
const reads: RatingsListReads = {
  access: async () => access,
  branchNames: async () =>
    new Map([
      [A.branch, { name_ar: null, name_en: 'In scope' }],
      [outside, { name_ar: null, name_en: 'Outside scope' }],
    ]),
  timeZone: async () => 'Asia/Kuwait',
  employeeNames: async () => new Map([[sara, { name_ar: null, name_en: 'Sara' }]]),
};
const page = (query: object) =>
  db.withTenant(
    context.companyId,
    (tx) => readRatingsList(tx, context, query, new Date('2026-06-30T12:00:00Z'), reads),
    { readOnly: true },
  );
const inScope: string[] = [];
const OUT_OF_SCOPE = 40;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${A.company},${outside},${A.business},'Outside')`;
  // الأقدم في الفرع المسموح والأحدث كلها في الفرع الخارجي: مسح تاريخ الموظفة بالأحدث أولاً بيعدّي على كل الخارجي قبل أول صف مسموح.
  for (let n = 0; n < 4; n += 1)
    inScope.push(
      await seedRating(db, A, { stars: 2, at: at(1 + n), performers: [sara], branch: A.branch }),
    );
  for (let n = 0; n < OUT_OF_SCOPE; n += 1)
    await seedRating(db, A, {
      stars: 1,
      at: at(10 + (n % 15), n % 24),
      performers: [sara],
      branch: outside,
    });
  await owner`ANALYZE rating_attributions`;
}, 180_000);
afterAll(async () => {
  await owner.end();
  await db.close();
  await testDb.drop();
});

it('walks an employee filter inside a narrower scope to the end, returning none of her ratings elsewhere', async () => {
  const seen: string[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const next: RatingsListPage = await page({
      employee_id: sara,
      limit: 2,
      ...(cursor === undefined ? {} : { cursor }),
    });
    expect(ratingsListPage.parse(next)).toEqual(next);
    for (const item of next.items) expect(item.branch.id).toBe(A.branch);
    seen.push(...next.items.map((item) => item.id));
    cursor = next.next_cursor ?? undefined;
    if (cursor !== undefined) {
      expect(cursors.has(cursor)).toBe(false);
      cursors.add(cursor);
    }
  } while (cursor);
  expect(seen).toEqual([...inScope].reverse());
});

it('a caller who covers the whole business keeps the employee-first scan', async () => {
  access = [A.branch, outside];
  try {
    const result = await page({ employee_id: sara, limit: 100 });
    expect(result.items).toHaveLength(inScope.length + OUT_OF_SCOPE);
  } finally {
    access = [A.branch];
  }
});
