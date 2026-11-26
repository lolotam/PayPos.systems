import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { RatingTenant } from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { seedRating } from '../queries/__tests__/ratings-list.fixture.ts';

// الشهر في قراءة التقييمات (`month=YYYY-MM`): السيرفر بيحوّله لنافذة بتوقيت النشاط، ومش بتوقيت الفرع ولا المتصفح.
const ids = systemUuidV7();
let h: Harness;
let db: Database;
let ownerCookie: string;
let company: string;
let business: string;
let branch: string;
let siblingBranch: string;
let tenant: RatingTenant;
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));
const url = (query = '') => `/v1/businesses/${business}/ratings${query}`;
const averagesUrl = (query = '') => `/v1/businesses/${business}/ratings/averages${query}`;
const get = (path: string) => h.send('GET', path, { cookie: ownerCookie, company });
const entry = (index: number, average: string, count: number) => ({
  employee_id: tenant.employees[index],
  name_ar: null,
  name_en: `Synthetic rated ${index}`,
  average,
  count,
});

beforeAll(async () => {
  h = await startHarness();
  ownerCookie = await h.signedInOperator('ratings-month-owner@example.test');
  company = await h.onboard(ownerCookie, 'Ratings month');
  business = ids.newId();
  await h.owner`INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, ${business}, 'Synthetic business', 'salon')`;
  [branch, siblingBranch] = [ids.newId(), ids.newId()];
  for (const id of [branch, siblingBranch])
    await h.owner`INSERT INTO branches (company_id, id, business_id, name_en)
      VALUES (${company}, ${id}, ${business}, 'Synthetic branch')`;
  const employees = [ids.newId(), ids.newId()] as const;
  for (const [index, employee] of employees.entries())
    await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES (${company},${employee},${business},${branch},${`Synthetic rated ${index}`},${`synthetic rated ${index}`},'staff','2026-01-01',${900 + index})`;
  tenant = { company, business, branch, customer: '', employees };
  db = createDatabase({ url: h.urls.app, ids });
});
afterAll(async () => {
  await db?.close();
  await h?.close();
});

const months = (query: string) => [url(query), averagesUrl(query)] as const;
const instantsOf = (body: Record<string, unknown>) =>
  (body['items'] as { id: string }[]).map((item) => item.id);

it('month is the business-zone calendar month: 21:30 UTC on the last day of March belongs to April in Kuwait', async () => {
  const march = await seedRating(db, tenant, {
    stars: 2,
    at: new Date('2031-03-31T20:30:00Z'),
    performers: [tenant.employees[0]],
  });
  const april = await seedRating(db, tenant, {
    stars: 5,
    at: new Date('2031-03-31T21:30:00Z'),
    performers: [tenant.employees[0]],
  });
  const [listMarch, averagesMarch] = months('?month=2031-03');
  expect(instantsOf((await get(listMarch)).body)).toEqual([march]);
  expect((await get(listMarch)).body['month']).toBe('2031-03');
  expect((await get(averagesMarch)).body).toEqual({
    items: [entry(0, '2.0', 1)],
    month: '2031-03',
  });
  const [listApril, averagesApril] = months('?month=2031-04');
  expect(instantsOf((await get(listApril)).body)).toEqual([april]);
  expect((await get(averagesApril)).body).toEqual({
    items: [entry(0, '5.0', 1)],
    month: '2031-04',
  });
});

it('the business zone decides the month even when the branches carry other zones', async () => {
  // الفرع بتوقيت لوس أنجلوس (31 مايو 17:30 محلياً) والنشاط بتوقيت الكويت (1 يونيو 03:30): الشهر شهر النشاط.
  const rating = await seedRating(db, tenant, {
    stars: 4,
    at: new Date('2031-06-01T00:30:00Z'),
    performers: [tenant.employees[0]],
  });
  await h.owner`UPDATE branches SET timezone='America/Los_Angeles' WHERE company_id=${company} AND id=${branch}`;
  await h.owner`UPDATE branches SET timezone='Pacific/Auckland' WHERE company_id=${company} AND id=${siblingBranch}`;
  try {
    const [listJune, averagesJune] = months('?month=2031-06');
    expect(instantsOf((await get(listJune)).body)).toContain(rating);
    expect((await get(averagesJune)).body).toEqual({
      items: [entry(0, '4.0', 1)],
      month: '2031-06',
    });
    const [listMay, averagesMay] = months('?month=2031-05');
    expect(instantsOf((await get(listMay)).body)).not.toContain(rating);
    expect((await get(averagesMay)).body).toEqual({ items: [], month: '2031-05' });
  } finally {
    await h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${company} AND business_id=${business}`;
  }
});

it('pages one month by cursor on the same month parameter without a duplicate or a gap', async () => {
  const seeded = [];
  for (const hour of [3, 9, 15])
    seeded.push(
      await seedRating(db, tenant, {
        stars: 3,
        at: new Date(Date.UTC(2032, 1, 10, hour)),
        performers: [tenant.employees[0]],
      }),
    );
  await seedRating(db, tenant, {
    stars: 3,
    at: new Date('2032-03-01T00:00:00Z'),
    performers: [tenant.employees[0]],
  });
  const first = await get(url('?month=2032-02&limit=2'));
  const next = first.body['next_cursor'] as string;
  const second = await get(url(`?month=2032-02&limit=2&cursor=${next}`));
  expect([...instantsOf(first.body), ...instantsOf(second.body)]).toEqual([...seeded].reverse());
  expect(second.body['next_cursor']).toBeNull();
});

it('refuses month together with from or to, and a malformed month, with 400 on both routes', async () => {
  const instant = at(1).toISOString();
  const bad = [
    `?month=2031-04&from=${instant}`,
    `?month=2031-04&to=${instant}`,
    '?month=2031-4',
    '?month=2031-13',
    '?month=2031-04-01',
  ];
  for (const query of bad) {
    const listed = await get(url(query));
    const averaged = await get(averagesUrl(query));
    expect([query, listed.status, averaged.status]).toEqual([query, 400, 400]);
  }
});

it('accepts an explicit range of exactly 366 days on the averages, and refuses a wider or a one-sided one with 422', async () => {
  // مدى سنة بالضبط (366 يوم) مقبول على تقرير المتوسطات (PP-278).
  const accepted = await get(averagesUrl('?from=2026-06-11T09:00:00Z&to=2027-06-12T09:00:00Z'));
  expect([accepted.status, accepted.body['month']]).toEqual([200, null]);
  const tooWide = 'from=2026-06-11T09:00:00Z&to=2027-06-12T09:00:00.000001Z';
  const fromOnly = 'from=2026-06-11T09:00:00Z';
  const toOnly = 'to=2027-06-12T09:00:00Z';
  for (const query of [tooWide, fromOnly, toOnly]) {
    const refused = await get(averagesUrl(`?${query}`));
    expect([query, refused.status, refused.body['code']]).toEqual([
      query,
      422,
      'RATING_RANGE_TOO_WIDE',
    ]);
    expect(refused.body['message_ar']).toEqual(expect.any(String));
    expect(refused.body['message_en']).toEqual(expect.any(String));
    expect(String(refused.body['message_ar']).length).toBeGreaterThan(0);
    expect(String(refused.body['message_en']).length).toBeGreaterThan(0);
  }
});

it('keeps the cursor-paginated ratings list open to a wider and to a one-sided range', async () => {
  const wide = 'from=2026-01-01T00:00:00Z&to=2028-01-01T00:00:00Z';
  expect((await get(url(`?${wide}`))).status).toBe(200);
  expect((await get(url('?from=2026-01-01T00:00:00Z'))).status).toBe(200);
  expect((await get(url('?to=2028-01-01T00:00:00Z'))).status).toBe(200);
});
