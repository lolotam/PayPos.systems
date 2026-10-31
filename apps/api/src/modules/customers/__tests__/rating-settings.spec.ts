import { ratingSettings } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  newHeldMember,
  permissionFixture,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';

let f: PermissionFixture;
/** نشاط في الشركة التانية: بيتبعت ليا معرّفه بعد ما يتعمل، عشان اختبار العزل يبقى على هدف حقيقي. */
let foreignBusiness = '';
/** نشاط جديد في الشركة: صف مفتاحه لسه مش موجود، عشان نختبر الكتابة الأولى من غير أثر مسبق. */
let freshBusiness = '';
/** نشاط تاني جديد: لتكرار نفس القيمة من غير ما يأثر على النشاط الأول. */
let repeatBusiness = '';

async function seedBusiness(company: string, name: string): Promise<string> {
  const id = f.ids.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${company},${id},${name},'salon')`;
  return id;
}

beforeAll(async () => {
  f = await permissionFixture();
  foreignBusiness = await seedBusiness(f.otherCompany, 'Synthetic foreign business');
  freshBusiness = await seedBusiness(f.company, 'Synthetic fresh business');
  repeatBusiness = await seedBusiness(f.company, 'Synthetic repeat business');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const path = (business: string) => `/v1/businesses/${business}/rating-settings`;
const read = (business: string, cookie = f.cookie, company = f.company) =>
  f.h.send('GET', path(business), { cookie, company });
const write = (
  requests_enabled: boolean,
  business: string,
  cookie = f.cookie,
  company = f.company,
) => f.h.send('PUT', path(business), { cookie, company, body: { requests_enabled } });
const audits = (business = f.business) => f.h
  .owner`SELECT action, before, after, actor_user_id FROM audit_log
  WHERE company_id=${f.company} AND entity_id=${business} AND action='customer.rating_requests_switched' ORDER BY id`;
const stored = (business = f.business) => f.h
  .owner`SELECT requests_enabled, revision FROM rating_settings
  WHERE company_id=${f.company} AND business_id=${business}`;

it('a business with no row reads as off, and the owner turns it on', async () => {
  const before = await read(f.business);
  expect(before.status).toBe(200);
  expect(ratingSettings.parse(before.body)).toEqual({ requests_enabled: false });

  const saved = await write(true, f.business);
  expect(saved.status).toBe(200);
  expect(ratingSettings.parse(saved.body)).toEqual({ requests_enabled: true });
  expect(ratingSettings.parse((await read(f.business)).body)).toEqual({ requests_enabled: true });

  const rows = await audits();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'customer.rating_requests_switched',
    before: { requests_enabled: null },
    after: { requests_enabled: true },
    actor_user_id: f.userId,
  });
});

it('turning it off again keeps one row, bumps the revision and audits what it replaced', async () => {
  const saved = await write(false, f.business);
  expect(saved.status).toBe(200);
  expect(ratingSettings.parse(saved.body)).toEqual({ requests_enabled: false });
  expect(ratingSettings.parse((await read(f.business)).body)).toEqual({ requests_enabled: false });
  expect(await stored()).toEqual([{ requests_enabled: false, revision: 2 }]);

  const rows = await audits();
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({
    before: { requests_enabled: true },
    after: { requests_enabled: false },
  });
});

it('a first write of the default off writes no row and audits nothing', async () => {
  const response = await write(false, freshBusiness);
  expect(response.status).toBe(200);
  expect(ratingSettings.parse(response.body)).toEqual({ requests_enabled: false });
  expect(await stored(freshBusiness)).toEqual([]);
  expect(await audits(freshBusiness)).toEqual([]);
});

it('writing the same value twice writes once and audits once', async () => {
  expect((await write(true, repeatBusiness)).status).toBe(200);
  expect((await write(true, repeatBusiness)).status).toBe(200);
  expect(ratingSettings.parse((await read(repeatBusiness)).body)).toEqual({
    requests_enabled: true,
  });
  expect(await stored(repeatBusiness)).toEqual([{ requests_enabled: true, revision: 1 }]);

  const rows = await audits(repeatBusiness);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    action: 'customer.rating_requests_switched',
    before: { requests_enabled: null },
    after: { requests_enabled: true },
  });
});

it('a caller without the permission gets the uniform 403 for both verbs', async () => {
  expect((await read(f.business, f.managerCookie)).status).toBe(403);
  expect((await write(true, f.business, f.managerCookie)).status).toBe(403);
  expect((await read(f.business, f.managerCookie)).body).toMatchObject({ code: 'FORBIDDEN' });
});

it('a business manager of the company gets the same 403 for both verbs', async () => {
  const cookie = await f.h.signedInOperator('rating-business-manager@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email = 'rating-business-manager@example.test'`;
  await newHeldMember(f, { userId: user?.['id'] as string }, 'business_manager');
  expect((await read(f.business, cookie)).status).toBe(403);
  expect((await write(true, f.business, cookie)).status).toBe(403);
  expect((await read(f.business, cookie)).body).toMatchObject({ code: 'FORBIDDEN' });
});

it('another company can neither read nor write the row', async () => {
  expect((await read(foreignBusiness, f.cookie, f.company)).status).toBe(403);
  expect((await write(true, foreignBusiness, f.cookie, f.company)).status).toBe(403);
  expect((await read(f.business, f.cookie, f.otherCompany)).status).toBe(403);
});

it('an unknown business id is a 403, not a screen of defaults', async () => {
  const unknown = f.ids.newId();
  expect((await read(unknown)).status).toBe(403);
  expect((await write(true, unknown)).status).toBe(403);
});

it('a body with a foreign key is refused before anything is written', async () => {
  const response = await f.h.send('PUT', path(f.business), {
    cookie: f.cookie,
    company: f.company,
    body: { requests_enabled: true, alerts_enabled: false },
  });
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
});
