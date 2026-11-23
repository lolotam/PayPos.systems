import { createDatabase, SYSTEM_ROLES, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { RatingTenant } from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { seedRating } from '../queries/__tests__/ratings-list.fixture.ts';

const code = 'read:ratings:branch';
const ids = systemUuidV7();
let h: Harness;
let db: Database;
let ownerCookie: string;
let ownerId: string;
let company: string;
let otherCompany: string;
let business: string;
let branch: string;
let siblingBranch: string;
let foreignBusiness: string;
let tenant: RatingTenant;
let layla: { cookie: string; member: string };
let ownRating: string;
const ownComment = 'Slow service, call 55512345';
// نافذة تقييمَي الأساس (10 و11 يونيو) بس: اختبارات القائمة ما تتأثرش بأي تقييم بتزرعه اختبارات تانية في نافذة غيرها.
const baseWindow = `from=${new Date(Date.UTC(2026, 5, 10)).toISOString()}&to=${new Date(Date.UTC(2026, 5, 12)).toISOString()}`;
// ساعة الراوت قابلة للتثبيت: اختبارات الشهر الحالي لازم ما تتوقفش على ساعة الجهاز اللي بيشغّلها.
let clockNow: Date | null = null;
const at = (day: number, hour = 12) => new Date(Date.UTC(2026, 5, day, hour));
const roleId = (roleCode: string) => SYSTEM_ROLES.find((r) => r.code === roleCode)?.id ?? '';
const url = (businessId = business, query = '') => `/v1/businesses/${businessId}/ratings${query}`;
const get = (cookie: string, path = url(), companyId = company) =>
  h.send('GET', path, { cookie, company: companyId });

/** نشاط وفرعين بالشكل اللي بيعمله مصنع الصلاحيات: إدخال مباشر كمالك داتابيز اختبار. */
async function newBusiness(companyId: string, branches: number) {
  const businessId = ids.newId();
  await h.owner`INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${companyId}, ${businessId}, 'Synthetic business', 'salon')`;
  const created: string[] = [];
  for (let n = 0; n < branches; n += 1) {
    const branchId = ids.newId();
    await h.owner`INSERT INTO branches (company_id, id, business_id, name_en)
      VALUES (${companyId}, ${branchId}, ${businessId}, 'Synthetic branch')`;
    created.push(branchId);
  }
  return { businessId, created };
}

/** مستخدم جديد بعضوية على الفرع بدور نظامي أو بدور مخصص عنده الخانة في role_permissions. */
async function operatorWith(email: string, roleCode: string, custom = false) {
  const cookie = await h.signedInOperator(email);
  const [user] = await h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const member = ids.newId();
  let role = { id: roleId(roleCode), key: 'global' };
  if (custom) {
    role = { id: ids.newId(), key: company };
    await h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${role.id},${company},${roleCode},'Synthetic custom')`;
    await h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES (${role.id},${company},${company},${code})`;
  }
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${member},${user?.['id'] as string},${role.id},${role.key},'BRANCH',${branch})`;
  return { cookie, member };
}

beforeAll(async () => {
  h = await startHarness({ customersClock: { now: () => clockNow ?? new Date() } });
  ownerCookie = await h.signedInOperator('ratings-owner@example.test');
  company = await h.onboard(ownerCookie, 'Ratings A');
  otherCompany = await h.onboard(ownerCookie, 'Ratings B');
  const [owner] = await h.owner`SELECT id FROM "user" WHERE email='ratings-owner@example.test'`;
  ownerId = owner?.['id'] as string;
  const own = await newBusiness(company, 2);
  business = own.businessId;
  [branch = '', siblingBranch = ''] = own.created;
  foreignBusiness = (await newBusiness(otherCompany, 1)).businessId;
  const employees = [ids.newId(), ids.newId()] as const;
  for (const [index, employee] of employees.entries())
    await h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES (${company},${employee},${business},${branch},${`Synthetic rated ${index}`},${`synthetic rated ${index}`},'staff','2026-01-01',${900 + index})`;
  tenant = { company, business, branch, customer: '', employees };
  db = createDatabase({ url: h.urls.app, ids });
  layla = await operatorWith('layla@example.test', 'branch_manager');
  // تقييمات الأساس بتتزرع هنا مرة، فأي اختبار يشتغل لوحده وبأي ترتيب.
  ownRating = await seedRating(db, tenant, {
    stars: 2,
    at: at(10),
    performers: [tenant.employees[0]],
    comment: ownComment,
    date: '2026-06-10',
  });
  await seedRating(db, tenant, {
    stars: 1,
    at: at(11),
    performers: [tenant.employees[1]],
    branch: siblingBranch,
  });
  const [first, second] = tenant.employees;
  await seedRating(db, tenant, { stars: 5, at: at(25, 12), performers: [first, second] });
  await seedRating(db, tenant, { stars: 4, at: at(25, 13), performers: [first] });
  await seedRating(db, tenant, {
    stars: 1,
    at: at(25, 14),
    performers: [second],
    branch: siblingBranch,
  });
});
afterAll(async () => {
  await db?.close();
  await h?.close();
});

it('gives a branch manager in scope the stars, instant, date, branch, performers and comment of her branch only', async () => {
  const response = await get(layla.cookie, url(business, `?${baseWindow}`));
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    items: [
      {
        id: ownRating,
        stars: 2,
        submitted_at: expect.stringMatching(/^2026-06-10T12:00:00\.\d{6}Z$/),
        business_date: '2026-06-10',
        branch: { id: branch, name_ar: null, name_en: 'Synthetic branch' },
        performers: [
          { employee_id: tenant.employees[0], name_ar: null, name_en: 'Synthetic rated 0' },
        ],
        comment: ownComment,
      },
    ],
    next_cursor: null,
    month: null,
  });
});

it('never returns a branch outside her scope, with or without the branch filter', async () => {
  const filtered = await get(layla.cookie, url(business, `?branch_id=${siblingBranch}`));
  expect(filtered.status).toBe(200);
  expect(filtered.body).toEqual({ items: [], next_cursor: null, month: null });
  expect(filtered.text).not.toContain(siblingBranch);
});

it('answers a malformed cursor with 400 for a branch outside her scope as well', async () => {
  const outside = `?branch_id=${siblingBranch}`;
  expect((await get(layla.cookie, url(business, `${outside}&cursor=garbage`))).status).toBe(400);
  expect((await get(layla.cookie, url(business, outside))).status).toBe(200);
});

it('shows the owner every branch of the business, newest first', async () => {
  const response = await get(ownerCookie, url(business, `?${baseWindow}`));
  expect(response.status).toBe(200);
  const items = response.body['items'] as { stars: number }[];
  expect(items.map((item) => item.stars)).toEqual([1, 2]);
});

it('refuses with 403 a member whose role has no ratings read, and a caller of no company membership', async () => {
  const cashier = await operatorWith('cashier-ratings@example.test', 'cashier');
  const refused = await get(cashier.cookie);
  expect(refused.status).toBe(403);
  expect(refused.text).not.toContain('Slow service');
  const outsider = await h.signedInOperator('outsider-ratings@example.test');
  expect((await get(outsider)).status).toBe(403);
});

it('refuses with 403 a custom role that holds the permission, because only the four manager roles read', async () => {
  const custom = await operatorWith('custom-ratings@example.test', 'branch_manager_clone', true);
  const refused = await get(custom.cookie);
  expect(refused.status).toBe(403);
  expect(refused.text).not.toContain('Slow service');
});

it('refuses with 403 a manager whose own membership lost the grant while a sibling custom membership still holds an ALLOW (owner decision 2026-11-22)', async () => {
  const email = 'pooled-ratings@example.test';
  const manager = await operatorWith(email, 'branch_manager');
  const [user] = await h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const customRole = ids.newId();
  await h.owner`INSERT INTO roles(id,company_id,code,name_en) VALUES (${customRole},${company},'pooled_viewer','Synthetic custom')`;
  await h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${company},${ids.newId()},${user?.['id'] as string},${customRole},${company},'BRANCH',${branch})`;
  const [sibling] = await h.owner`SELECT id FROM memberships
    WHERE company_id=${company} AND user_id=${user?.['id'] as string} AND role_id=${customRole}`;
  await h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${ids.newId()},${sibling?.['id'] as string},${code},'ALLOW','BRANCH',${branch},'Synthetic sibling grant',${ownerId})`;
  const managerRole = roleId('branch_manager');
  expect((await get(manager.cookie)).status).toBe(200);
  const [saved] =
    await h.owner`SELECT role_id, role_owner_key, company_id, permission_code FROM role_permissions
    WHERE role_id=${managerRole} AND role_owner_key='global' AND permission_code=${code}`;
  expect(saved).toBeDefined();
  await h.owner`DELETE FROM role_permissions
    WHERE role_id=${managerRole} AND role_owner_key='global' AND permission_code=${code}`;
  try {
    const list = await get(manager.cookie);
    const averages = await get(manager.cookie, averagesUrl());
    expect([list.status, averages.status]).toEqual([403, 403]);
    expect(list.text).not.toContain('Slow service');
  } finally {
    await h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES (${saved?.['role_id'] as string},${saved?.['role_owner_key'] as string},${(saved?.['company_id'] ?? null) as string | null},${saved?.['permission_code'] as string})`;
  }
  expect((await get(manager.cookie)).status).toBe(200);
});

it('refuses with 403 once a role is changed to cashier after the grant, and reads again when it is restored', async () => {
  const member = await operatorWith('changed-ratings@example.test', 'branch_manager');
  await h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${company},${ids.newId()},${member.member},${code},'ALLOW','BRANCH',${branch},'Synthetic grant',${ownerId})`;
  expect((await get(member.cookie)).status).toBe(200);
  const setRole = (role: string) => h.owner`UPDATE memberships SET role_id=${roleId(role)}
    WHERE company_id=${company} AND id=${member.member}`;
  await setRole('cashier');
  const refused = await get(member.cookie);
  expect(refused.status).toBe(403);
  expect(refused.text).not.toContain('Slow service');
  await setRole('branch_manager');
  expect((await get(member.cookie)).status).toBe(200);
});

it('returns nothing of another tenant: a foreign business answers 403 and carries no rating', async () => {
  const asOwn = await get(ownerCookie, url(foreignBusiness));
  expect(asOwn.status).toBe(403);
  expect(asOwn.body).not.toHaveProperty('items');
  const crossed = await get(ownerCookie, url(business), otherCompany);
  expect(crossed.status).toBe(403);
  expect(crossed.text).not.toContain('Slow service');
});

it('pages by cursor without a duplicate or a gap, and rejects a bad limit or cursor with 400', async () => {
  const tied: string[] = [];
  for (let n = 0; n < 3; n += 1)
    tied.push(
      await seedRating(db, tenant, { stars: 4, at: at(20), performers: [tenant.employees[0]] }),
    );
  const window = `from=${at(20).toISOString()}&to=${at(21).toISOString()}`;
  const first = await get(ownerCookie, url(business, `?${window}&limit=2`));
  const next = first.body['next_cursor'] as string;
  const second = await get(ownerCookie, url(business, `?${window}&limit=2&cursor=${next}`));
  const seen = [
    ...(first.body['items'] as { id: string }[]),
    ...(second.body['items'] as { id: string }[]),
  ];
  expect(seen.map((item) => item.id)).toEqual([...tied].sort().reverse());
  expect(second.body['next_cursor']).toBeNull();
  expect((await get(ownerCookie, url(business, '?limit=0'))).status).toBe(400);
  expect((await get(ownerCookie, url(business, '?cursor=garbage'))).status).toBe(400);
  // مؤشر ترميزه سليم وتاريخه ترفضه PostgreSQL لازم يرجع 400 موحد مش 500 من الـcast.
  const forged = (at: string) =>
    Buffer.from(JSON.stringify({ at, id: tied[0] })).toString('base64url');
  for (const at of ['0000-06-15T12:00:00Z', '2026-06-15T12:00:00+16:00'])
    expect((await get(ownerCookie, url(business, `?cursor=${forged(at)}`))).status).toBe(400);
});

it('refuses a request without a session', async () => {
  const response = await h.app.inject({
    method: 'GET',
    url: url(),
    headers: { 'x-company-id': company },
  });
  expect(response.statusCode).toBe(401);
});

const averagesUrl = (query = '', businessId = business) =>
  `/v1/businesses/${businessId}/ratings/averages${query}`;
const entry = (index: number, average: string, count: number) => ({
  employee_id: tenant.employees[index],
  name_ar: null,
  name_en: `Synthetic rated ${index}`,
  average,
  count,
});

it('averages per employee, counting a two-performer rating for both, over every branch for the owner', async () => {
  const window = `?from=${at(25, 0).toISOString()}&to=${at(26, 0).toISOString()}`;
  const response = await get(ownerCookie, averagesUrl(window));
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    items: [entry(0, '4.5', 2), entry(1, '3.0', 2)],
    month: null,
  });
});

it('limits the averages of a branch manager to her branch, with or without the branch filter', async () => {
  const window = `from=${at(25, 0).toISOString()}&to=${at(26, 0).toISOString()}`;
  const scoped = await get(layla.cookie, averagesUrl(`?${window}`));
  expect(scoped.status).toBe(200);
  expect(scoped.body).toEqual({
    items: [entry(0, '4.5', 2), entry(1, '5.0', 1)],
    month: null,
  });
  const sibling = await get(layla.cookie, averagesUrl(`?${window}&branch_id=${siblingBranch}`));
  expect(sibling.body).toEqual({ items: [], month: null });
  const only = await get(ownerCookie, averagesUrl(`?${window}&employee_id=${tenant.employees[1]}`));
  expect(only.body).toEqual({ items: [entry(1, '3.0', 2)], month: null });
});

it('defaults to the current calendar month in the business time zone, on a fixed mid-month clock', async () => {
  const day = 24 * 60 * 60 * 1000;
  const mid = new Date(Date.UTC(2030, 5, 15, 12));
  clockNow = mid;
  try {
    await seedRating(db, tenant, {
      stars: 3,
      at: new Date(mid.getTime() - 60_000),
      performers: [tenant.employees[0]],
    });
    await seedRating(db, tenant, {
      stars: 1,
      at: new Date(mid.getTime() - 62 * day),
      performers: [tenant.employees[0]],
    });
    const response = await get(ownerCookie, averagesUrl(`?employee_id=${tenant.employees[0]}`));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [entry(0, '3.0', 1)], month: '2030-06' });
  } finally {
    clockNow = null;
  }
});

it('refuses the averages with 403 to a cashier, a custom role, a stranger and a foreign business', async () => {
  const cashier = await operatorWith('cashier-averages@example.test', 'cashier');
  expect((await get(cashier.cookie, averagesUrl())).status).toBe(403);
  const custom = await operatorWith('custom-averages@example.test', 'branch_manager_copy', true);
  expect((await get(custom.cookie, averagesUrl())).status).toBe(403);
  const outsider = await h.signedInOperator('outsider-averages@example.test');
  expect((await get(outsider, averagesUrl())).status).toBe(403);
  const foreign = await get(ownerCookie, averagesUrl('', foreignBusiness));
  expect(foreign.status).toBe(403);
  expect(foreign.body).not.toHaveProperty('items');
  expect((await get(ownerCookie, averagesUrl(), otherCompany)).status).toBe(403);
});

it('rejects an unknown or inverted filter with 400 and a request without a session with 401', async () => {
  expect((await get(ownerCookie, averagesUrl('?limit=5'))).status).toBe(400);
  const inverted = `?from=${at(26).toISOString()}&to=${at(25).toISOString()}`;
  expect((await get(ownerCookie, averagesUrl(inverted))).status).toBe(400);
  const anonymous = await h.app.inject({
    method: 'GET',
    url: averagesUrl(),
    headers: { 'x-company-id': company },
  });
  expect(anonymous.statusCode).toBe(401);
});

it('accepts a range inside one millisecond over HTTP, keeps its microseconds, and refuses an equal or inverted one (F4)', async () => {
  const rating = await seedRating(db, tenant, {
    stars: 5,
    at: new Date('2026-07-01T12:00:00.123Z'),
    performers: [tenant.employees[0]],
    date: '2026-07-01',
  });
  const edge = '2026-07-01T12:00:00';
  const miss = `from=${edge}.123001Z&to=${edge}.123999Z`;
  const hit = `from=${edge}.122999Z&to=${edge}.123001Z`;
  const same = `from=${edge}.123001Z&to=${edge}.123001Z`;
  const inverted = `from=${edge}.123999Z&to=${edge}.123001Z`;
  const idsOf = (body: Record<string, unknown>) =>
    (body['items'] as { id: string }[]).map((i) => i.id);
  const listMiss = await get(ownerCookie, url(business, `?${miss}`));
  expect([listMiss.status, idsOf(listMiss.body)]).toEqual([200, []]);
  const listHit = await get(ownerCookie, url(business, `?${hit}`));
  expect([listHit.status, idsOf(listHit.body)]).toEqual([200, [rating]]);
  const averagesMiss = await get(ownerCookie, averagesUrl(`?${miss}`));
  expect([averagesMiss.status, averagesMiss.body]).toEqual([200, { items: [], month: null }]);
  const averagesHit = await get(ownerCookie, averagesUrl(`?${hit}`));
  expect([averagesHit.status, averagesHit.body]).toEqual([
    200,
    { items: [entry(0, '5.0', 1)], month: null },
  ]);
  for (const query of [same, inverted]) {
    expect((await get(ownerCookie, url(business, `?${query}`))).status).toBe(400);
    expect((await get(ownerCookie, averagesUrl(`?${query}`))).status).toBe(400);
  }
});

it('refuses more than six fractional digits on a bound with 400 on both endpoints, and answers a valid microsecond range inside one millisecond with 200 (G6)', async () => {
  const rating = await seedRating(db, tenant, {
    stars: 4,
    at: new Date('2026-07-02T12:00:00.123Z'),
    performers: [tenant.employees[0]],
    date: '2026-07-02',
  });
  const edge = '2026-07-02T12:00:00';
  const idsOf = (body: Record<string, unknown>) =>
    (body['items'] as { id: string }[]).map((i) => i.id);
  const tooLong = [
    `from=${edge}.123456Z&to=${edge}.1234561Z`,
    `from=${edge}.1234561Z&to=${edge}.123457Z`,
    `from=${edge}.1234561Z`,
    `to=${edge}.1234561Z`,
  ];
  for (const query of tooLong) {
    const listed = await get(ownerCookie, url(business, `?${query}`));
    const averaged = await get(ownerCookie, averagesUrl(`?${query}`));
    expect([query, listed.status, averaged.status]).toEqual([query, 400, 400]);
    expect(listed.body).not.toHaveProperty('items');
    expect(averaged.body).not.toHaveProperty('items');
  }
  const hit = `from=${edge}.123000Z&to=${edge}.123001Z`;
  const miss = `from=${edge}.123456Z&to=${edge}.123457Z`;
  const listHit = await get(ownerCookie, url(business, `?${hit}`));
  expect([listHit.status, idsOf(listHit.body)]).toEqual([200, [rating]]);
  const listMiss = await get(ownerCookie, url(business, `?${miss}`));
  expect([listMiss.status, idsOf(listMiss.body)]).toEqual([200, []]);
  const averagesHit = await get(ownerCookie, averagesUrl(`?${hit}`));
  expect([averagesHit.status, averagesHit.body]).toEqual([
    200,
    { items: [entry(0, '4.0', 1)], month: null },
  ]);
  const averagesMiss = await get(ownerCookie, averagesUrl(`?${miss}`));
  expect([averagesMiss.status, averagesMiss.body]).toEqual([200, { items: [], month: null }]);
});
