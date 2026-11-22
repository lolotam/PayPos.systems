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
  h = await startHarness();
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
});
afterAll(async () => {
  await db?.close();
  await h?.close();
});

it('gives a branch manager in scope the stars, instant, date, branch, performers and comment of her branch only', async () => {
  const comment = 'Slow service, call 55512345';
  const own = await seedRating(db, tenant, {
    stars: 2,
    at: at(10),
    performers: [tenant.employees[0]],
    comment,
    date: '2026-06-10',
  });
  await seedRating(db, tenant, {
    stars: 1,
    at: at(11),
    performers: [tenant.employees[1]],
    branch: siblingBranch,
  });
  const response = await get(layla.cookie);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.body).toEqual({
    items: [
      {
        id: own,
        stars: 2,
        submitted_at: expect.stringMatching(/^2026-06-10T12:00:00\.\d{6}Z$/),
        business_date: '2026-06-10',
        branch: { id: branch, name_ar: null, name_en: 'Synthetic branch' },
        performers: [{ employee_id: tenant.employees[0] }],
        comment,
      },
    ],
    next_cursor: null,
  });
});

it('never returns a branch outside her scope, with or without the branch filter', async () => {
  const filtered = await get(layla.cookie, url(business, `?branch_id=${siblingBranch}`));
  expect(filtered.status).toBe(200);
  expect(filtered.body).toEqual({ items: [], next_cursor: null });
  expect(filtered.text).not.toContain(siblingBranch);
});

it('shows the owner every branch of the business, newest first', async () => {
  const response = await get(ownerCookie);
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
  const tied = [];
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
});

it('refuses a request without a session', async () => {
  const response = await h.app.inject({
    method: 'GET',
    url: url(),
    headers: { 'x-company-id': company },
  });
  expect(response.statusCode).toBe(401);
});
