import { ratingSettings } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';

let f: PermissionFixture;
/** نشاط في الشركة التانية: بيتبعت ليا معرّفه بعد ما يتعمل، عشان اختبار العزل يبقى على هدف حقيقي. */
let foreignBusiness = '';
beforeAll(async () => {
  f = await permissionFixture();
  foreignBusiness = f.ids.newId();
  await f.h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES(${f.otherCompany},${foreignBusiness},'Synthetic foreign business','salon')`;
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
const audits = () => f.h.owner`SELECT action, before, after, actor_user_id FROM audit_log
  WHERE company_id=${f.company} AND action='customer.rating_requests_switched' ORDER BY id`;
const stored = () => f.h.owner`SELECT requests_enabled, revision FROM rating_settings
  WHERE company_id=${f.company} AND business_id=${f.business}`;

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

it('a caller without the permission gets the uniform 403 for both verbs', async () => {
  expect((await read(f.business, f.managerCookie)).status).toBe(403);
  expect((await write(true, f.business, f.managerCookie)).status).toBe(403);
  expect((await read(f.business, f.managerCookie)).body).toMatchObject({ code: 'FORBIDDEN' });
});

it('the owner role holds the permission by default and the business manager does not', async () => {
  const rows = await f.h.owner<{ code: string }[]>`
    SELECT r.code FROM role_permissions p JOIN roles r ON r.id = p.role_id
    WHERE p.permission_code = 'manage:rating-requests:business' AND r.company_id IS NULL
    ORDER BY r.code`;
  expect(rows.map((row) => row.code)).toEqual(['owner']);
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
