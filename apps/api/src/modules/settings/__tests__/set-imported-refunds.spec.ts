import { errorEnvelope, importedRefundsResponse, setImportedRefundsInput } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  newHeldMember,
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { createSettingsTransactions } from '../persistence/settings-transactions.ts';
import { readImportedRefundsEnabled } from '../index.ts';
import { SetImportedRefunds } from '../use-cases/set-imported-refunds/set-imported-refunds.ts';
import { claimPayload } from '../../../../test/device-claim.ts';

let f: PermissionFixture;
let foreignBusiness: string;

beforeAll(async () => {
  f = await permissionFixture();
  foreignBusiness = f.ids.newId();
  await f.h.owner`INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${f.otherCompany}, ${foreignBusiness}, 'Foreign synthetic business', 'salon')`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const url = (business = f.business) => `/v1/businesses/${business}/settings/imported-refunds`;
const get = (business = f.business, cookie = f.cookie, company = f.company) =>
  f.h.send('GET', url(business), { cookie, company });
const put = (body: object, business = f.business, cookie = f.cookie, company = f.company) =>
  f.h.app.inject({
    method: 'PUT',
    url: url(business),
    headers: { cookie, 'x-company-id': company },
    payload: body,
  });
const stored = (business = f.business) =>
  f.h.owner`SELECT imported_refunds_enabled, updated_by FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${business}`;
const audits = () =>
  f.h.owner`SELECT actor_user_id, before, after FROM audit_log
    WHERE company_id = ${f.company} AND entity = 'business_settings'
      AND entity_id = ${f.business} AND action = 'settings.imported_refunds_switched'
    ORDER BY id`;
const clearRow = (business = f.business) =>
  f.h
    .owner`DELETE FROM business_settings WHERE company_id = ${f.company} AND business_id = ${business}`;

it('IRS-01: no row, a stored null and a stored false all read off', async () => {
  await clearRow();
  expect(importedRefundsResponse.parse((await get()).body)).toEqual({
    imported_refunds_enabled: false,
  });
  await f.h.owner`INSERT INTO business_settings (company_id, business_id, imported_refunds_enabled)
    VALUES (${f.company}, ${f.business}, null)`;
  expect(importedRefundsResponse.parse((await get()).body)).toEqual({
    imported_refunds_enabled: false,
  });
  await f.h.owner`UPDATE business_settings SET imported_refunds_enabled = false
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(importedRefundsResponse.parse((await get()).body)).toEqual({
    imported_refunds_enabled: false,
  });
});

it('IRS-02: the owner switches on then off, and each effective change is one audited entry', async () => {
  const before = {
    default_language: 'ar' as const,
    calendar: 'gregorian' as const,
    limit_bps: 1500,
    official_name_ar: 'صالون لمسة',
    official_name_en: 'Lamsa',
    logo_file_id: null as string | null,
  };
  await clearRow();
  await f.h.owner`INSERT INTO business_settings
    (company_id, business_id, default_language, calendar, limit_bps, official_name_ar, official_name_en, logo_file_id)
    VALUES (${f.company}, ${f.business}, ${before.default_language}, ${before.calendar}, ${before.limit_bps},
      ${before.official_name_ar}, ${before.official_name_en}, ${before.logo_file_id})`;
  const on = await put({ imported_refunds_enabled: true });
  expect(on.statusCode).toBe(200);
  expect(importedRefundsResponse.parse(on.json())).toEqual({ imported_refunds_enabled: true });
  const [row] = await stored();
  expect(row).toEqual({ imported_refunds_enabled: true, updated_by: f.userId });
  const untouched = await f.h.owner`SELECT default_language, calendar, limit_bps,
    official_name_ar, official_name_en, logo_file_id FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  expect(untouched).toEqual([before]);
  const off = await put({ imported_refunds_enabled: false });
  expect(off.statusCode).toBe(200);
  expect(await audits()).toEqual([
    {
      actor_user_id: f.userId,
      before: { imported_refunds_enabled: null },
      after: { imported_refunds_enabled: true },
    },
    {
      actor_user_id: f.userId,
      before: { imported_refunds_enabled: true },
      after: { imported_refunds_enabled: false },
    },
  ]);
});

it('IRS-03: a repeat of the effective value writes nothing and adds no audit entry', async () => {
  const before = await audits();
  const [beforeRow] = await stored();
  const repeat = await put({ imported_refunds_enabled: false });
  expect(repeat.statusCode).toBe(200);
  expect(await stored()).toEqual([beforeRow]);
  expect(await audits()).toEqual(before);
  await clearRow();
  const noRow = await put({ imported_refunds_enabled: false });
  expect(noRow.statusCode).toBe(200);
  // القفل ينشئ صف الإعدادات الفارغ كسائر كتابات الإعدادات، لكن لا قيمة ولا تدقيق.
  expect(
    await f.h.owner`SELECT imported_refunds_enabled FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`,
  ).toEqual([{ imported_refunds_enabled: null }]);
  expect(await audits()).toEqual(before);
});

/** عضوية مستخدم موقّع حديثًا بمنح شخصي على النشاط — سيناريوهات الرفض بتستخدمها. */
async function codeHolder(
  email: string,
  permission_code = 'manage:imported-refunds:business',
): Promise<{ cookie: string; member: string }> {
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  const member = await newHeldMember(f, { userId: user?.['id'] as string });
  await seedOverride(f, member, {
    permission_code,
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  return { cookie, member };
}

it('IRS-04a: a granted human may read and write, and updated_by carries the actor', async () => {
  await clearRow();
  await seedOverride(f, f.managerMember, {
    permission_code: 'manage:imported-refunds:business',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  expect((await get(f.business, f.managerCookie)).status).toBe(200);
  const granted = await put({ imported_refunds_enabled: true }, f.business, f.managerCookie);
  expect(granted.statusCode).toBe(200);
  expect(await stored()).toEqual([{ imported_refunds_enabled: true, updated_by: f.managerId }]);
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id = ${f.company}
    AND membership_id = ${f.managerMember}`;
});

/** بيرفض المسارين ويثبت إن صف الإعدادات والتدقيق ما اتلمسوش — سيناريو رفض كامل لكل حالة. */
async function refusesBothRoutes(cookie: string) {
  const [beforeRow] = await stored();
  const beforeAudits = await audits();
  expect((await get(f.business, cookie)).status).toBe(403);
  const write = await put({ imported_refunds_enabled: true }, f.business, cookie);
  expect(write.statusCode).toBe(403);
  expect(await stored()).toEqual([beforeRow]);
  expect(await audits()).toEqual(beforeAudits);
}

it('IRS-04b: every refusal scenario refuses both routes and leaves the value and audit untouched', async () => {
  // settings-only manager: manage:settings:business alone is the same 403 on both routes.
  const settingsHolder = await codeHolder(
    'refunds-settings-manager@example.test',
    'manage:settings:business',
  );
  const settingsRead = await get(f.business, settingsHolder.cookie);
  expect([settingsRead.status, errorEnvelope.parse(settingsRead.body).code]).toEqual([
    403,
    'FORBIDDEN',
  ]);
  await refusesBothRoutes(settingsHolder.cookie);

  // an explicit DENY covering the business refuses a holder who would otherwise read or write.
  const denied = await codeHolder('refunds-denied-holder@example.test');
  await seedOverride(f, denied.member, {
    permission_code: 'manage:imported-refunds:business',
    effect: 'DENY',
    scope_type: 'BUSINESS',
    scope_id: f.business,
  });
  await refusesBothRoutes(denied.cookie);

  // an expired grant is not a grant.
  const expired = await codeHolder('refunds-expired-holder@example.test');
  await f.h.owner`UPDATE permission_overrides SET expires_at = clock_timestamp() - interval '1 hour'
    WHERE company_id = ${f.company} AND membership_id = ${expired.member}
      AND permission_code = 'manage:imported-refunds:business'`;
  await refusesBothRoutes(expired.cookie);

  // a grant naming another business of the same company does not travel.
  const elsewhere = await codeHolder('refunds-elsewhere-holder@example.test');
  await f.h.owner`UPDATE permission_overrides SET scope_id = ${f.otherBusiness}
    WHERE company_id = ${f.company} AND membership_id = ${elsewhere.member}
      AND permission_code = 'manage:imported-refunds:business'`;
  await refusesBothRoutes(elsewhere.cookie);

  // a branch-scoped grant cannot drive the business-wide switch in either direction.
  const branchHolder = await codeHolder('refunds-branch-holder@example.test');
  await f.h.owner`UPDATE permission_overrides SET scope_type = 'BRANCH', scope_id = ${f.branch}
    WHERE company_id = ${f.company} AND membership_id = ${branchHolder.member}
      AND permission_code = 'manage:imported-refunds:business'`;
  await refusesBothRoutes(branchHolder.cookie);

  // an anonymous caller is unauthenticated.
  expect((await get(f.business, '')).status).toBe(401);
});

it('IRS-04c: another company\'s business refuses both routes and writes nothing there', async () => {
  // نثبت الرفض سواء اختار المحرر الشركة التانية أو قدم نشاطها وهو داخل شركته.
  for (const company of [f.otherCompany, f.company]) {
    expect((await get(foreignBusiness, f.managerCookie, company)).status).toBe(403);
    const write = await put(
      { imported_refunds_enabled: true },
      foreignBusiness,
      f.managerCookie,
      company,
    );
    expect(write.statusCode).toBe(403);
  }
  expect(
    await f.h.owner`SELECT count(*)::int AS rows FROM business_settings
      WHERE company_id = ${f.otherCompany} AND business_id = ${foreignBusiness}`,
  ).toEqual([{ rows: 0 }]);
});

it('IRS-04 device refusal: a device principal is refused on both routes', async (ctx) => {
  // أكواد الاقتران في Redis: لو الـ Redis متاح فعلاً (زي CI) الخطوة إلزامية وما تتخطاش؛
  // التخطي الوحيد المسموح هو الغياب البيئي المثبت على الـ lane المحلي، وبيتسجل بسبب.
  let redisAvailable = true;
  try {
    await f.h.redis.ping();
  } catch {
    redisAvailable = false;
  }
  const code = await f.h.send('POST', `/v1/branches/${f.branch}/devices/pairing-code`, {
    cookie: f.cookie,
    company: f.company,
  });
  if (!redisAvailable && !process.env['CI']) {
    console.warn(
      'IRS-04 device refusal skipped locally: this lane has no Redis (pairing codes are Redis-backed); it runs and must pass where Redis is up.',
    );
    ctx.skip();
  }
  expect(code.status).toBe(201);
  const registered = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/register',
    payload: { pairing_code: code.body['code'], label: 'Synthetic refunds refusal' },
  });
  const device = registered.json<{ company_id: string; device_id: string; claim_secret: string }>();
  const approved = await f.h.send(
    'POST',
    `/v1/branches/${f.branch}/devices/${device.device_id}/approve`,
    { cookie: f.cookie, company: f.company },
  );
  expect(approved.status).toBe(204);
  const claimed = await f.h.app.inject({
    method: 'POST',
    url: '/v1/devices/claim',
    payload: claimPayload(device),
  });
  const token = claimed.json<{ device_token: string }>().device_token;
  const deviceHeaders = {
    authorization: `Device ${token}`,
    'x-company-id': f.company,
    origin: 'http://admin.test',
  };
  const deviceRead = await f.h.app.inject({ method: 'GET', url: url(), headers: deviceHeaders });
  expect(deviceRead.statusCode).toBe(403);
  const deviceWrite = await f.h.app.inject({
    method: 'PUT',
    url: url(),
    payload: { imported_refunds_enabled: true },
    headers: deviceHeaders,
  });
  expect(deviceWrite.statusCode).toBe(403);
});

it('IRS-05: a malformed body is validation and the generic settings write still refuses the field', async () => {
  await f.h.owner`UPDATE business_settings SET imported_refunds_enabled = false
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const before = await audits();
  for (const body of [
    {},
    { imported_refunds_enabled: 'on' },
    { imported_refunds_enabled: null },
    { imported_refunds_enabled: true, reason: 'unknown key' },
  ]) {
    const res = await put(body);
    expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([
      400,
      'VALIDATION_FAILED',
    ]);
  }
  const generic = await f.h.app.inject({
    method: 'PATCH',
    url: `/v1/businesses/${f.business}/settings`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: { imported_refunds_enabled: true },
  });
  expect([generic.statusCode, errorEnvelope.parse(generic.json()).code]).toEqual([
    400,
    'VALIDATION_FAILED',
  ]);
  expect(await audits()).toHaveLength(before.length);
  const [row] = await stored();
  expect(row?.['imported_refunds_enabled']).toBe(false);
});

it('IRS-07: a failed audit entry rolls the value back', async () => {
  await f.h.owner`UPDATE business_settings SET imported_refunds_enabled = null
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  const failingAudit = {
    record: async () => {
      throw new Error('audit unavailable');
    },
  };
  const transactions = createSettingsTransactions(f.db, f.ids);
  const useCase = new SetImportedRefunds({
    run: (companyId, userId, work) =>
      transactions.run(companyId, userId, (scope) => work({ ...scope, audit: failingAudit })),
  });
  await expect(
    useCase.execute(
      { companyId: f.company, userId: f.userId },
      f.business,
      setImportedRefundsInput.parse({ imported_refunds_enabled: true }),
    ),
  ).rejects.toThrow('audit unavailable');
  expect(
    await f.h.owner`SELECT imported_refunds_enabled FROM business_settings
      WHERE company_id = ${f.company} AND business_id = ${f.business}`,
  ).toEqual([{ imported_refunds_enabled: null }]);
});

it('IRS-09: the refund reader sees the exact value the switch stored', async () => {
  await put({ imported_refunds_enabled: true });
  expect(
    await f.db.withTenant(f.company, (tx) => readImportedRefundsEnabled(tx, f.company, f.business)),
  ).toBe(true);
  await put({ imported_refunds_enabled: false });
  expect(
    await f.db.withTenant(f.company, (tx) => readImportedRefundsEnabled(tx, f.company, f.business)),
  ).toBe(false);
  await clearRow();
});
