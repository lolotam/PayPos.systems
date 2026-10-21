import { recordingContext, sessionPerformerOptionPage } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

// PP-19.1: قايمة محرر المنفّذين (الأسامي وسياق الوقت) بتظهر لصلاحية التسجيل أو تغيير المنفّذين؛ قايمة الخدمات بتفضل للتسجيل بس.
let f: SessionFixture;
const occurred_at = '2026-10-14T08:00:00Z';
beforeAll(async () => {
  f = await sessionFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } });
});
afterAll(async () => {
  await f?.close();
});

const options = () =>
  f.h.send('GET', `${f.base}/performer-options?occurred_at=${occurred_at}&lang=en&limit=2`, {
    cookie: f.cookie,
    company: f.company,
  });
const context = () =>
  f.h.send('GET', `${f.base}/recording-context`, { cookie: f.cookie, company: f.company });
const services = () =>
  f.h.send('GET', `${f.base}/service-options?lang=en&limit=2`, {
    cookie: f.cookie,
    company: f.company,
  });

async function role(code: string) {
  const roleId = must(SYSTEM_ROLES.find((row) => row.code === code)).id;
  await f.h
    .owner`UPDATE memberships SET role_id=${roleId},scope_type='BRANCH',scope_id=${f.branch},ends_at=NULL
    WHERE company_id=${f.company} AND id=${f.membership}`;
}

async function override(permission: string, effect: 'ALLOW' | 'DENY') {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},${permission},${effect},'BRANCH',${f.branch},null,'Synthetic picker access',${f.ownerId})`;
}

beforeEach(async () => {
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  await role('staff');
});

it('opens both picker reads to change:service-line-performers:branch alone, with the same fields', async () => {
  await override('change:service-line-performers:branch', 'ALLOW');
  const names = await options();
  expect(names.status).toBe(200);
  const page = sessionPerformerOptionPage.parse(names.body);
  expect(page.items.length).toBeGreaterThan(0);
  for (const item of page.items)
    expect(Object.keys(item).sort()).toEqual([
      'approved_leave_warning',
      'employee_number',
      'id',
      'name_ar',
      'name_en',
      'not_clocked_in_warning',
    ]);
  const read = await context();
  expect(read.status).toBe(200);
  expect(recordingContext.parse(read.body).recorder_membership_ids).toEqual([f.membership]);
  expect(JSON.stringify([names.body, read.body])).not.toMatch(/phone/i);
});

it('keeps the service list for recording only', async () => {
  await override('change:service-line-performers:branch', 'ALLOW');
  expect((await services()).status).toBe(403);
  await override('record:service-sessions:branch', 'ALLOW');
  expect((await services()).status).toBe(200);
});

it('lets a change holder through even when recording is denied on the branch', async () => {
  await role('branch_manager');
  await override('record:service-sessions:branch', 'DENY');
  expect((await services()).status).toBe(403);
  expect((await options()).status).toBe(200);
  expect((await context()).status).toBe(200);
});

it('refuses a caller with neither permission, or with change denied and no record', async () => {
  expect((await options()).status).toBe(403);
  expect((await context()).status).toBe(403);
  await role('branch_manager');
  await override('record:service-sessions:branch', 'DENY');
  await override('change:service-line-performers:branch', 'DENY');
  expect((await options()).status).toBe(403);
  expect((await context()).status).toBe(403);
});

it('returns FEATURE_DISABLED to a change holder when orders is off', async () => {
  await override('change:service-line-performers:branch', 'ALLOW');
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic picker feature',${f.ownerId})`;
  for (const response of [await options(), await context()]) {
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('FEATURE_DISABLED');
  }
});

it('refuses the change holder on another branch', async () => {
  await override('change:service-line-performers:branch', 'ALLOW');
  const other = `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`;
  const response = await f.h.send('GET', `${other}/recording-context`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(response.status).toBe(403);
});

it('lets a record holder through even when change is denied on the branch', async () => {
  await role('cashier');
  await override('change:service-line-performers:branch', 'DENY');
  expect((await options()).status).toBe(200);
  expect((await context()).status).toBe(200);
});

it('refuses the change holder on another branch for the names list too', async () => {
  await override('change:service-line-performers:branch', 'ALLOW');
  const other = `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/service-sessions`;
  const response = await f.h.send(
    'GET',
    `${other}/performer-options?occurred_at=${occurred_at}&lang=en&limit=2`,
    { cookie: f.cookie, company: f.company },
  );
  expect(response.status).toBe(403);
  expect(response.body['code']).toBe('FORBIDDEN');
});

it('answers FORBIDDEN, not FEATURE_DISABLED, to a caller with neither permission when orders is off', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic picker feature',${f.ownerId})`;
  for (const response of [await options(), await context()]) {
    expect(response.status).toBe(403);
    expect(response.body['code']).toBe('FORBIDDEN');
  }
});

// @Require كان بيرفض الجهاز لوحده؛ بعد @Authenticated الرفض بقى من SelectedCompanyGuard وSessionAdminGuard.
it('refuses a paired device on both picker routes', async () => {
  const device = await paired(f.h, f.ownerCookie, f.company, f.branch);
  const headers = { authorization: `Device ${device.token}`, origin, 'x-company-id': f.company };
  for (const url of [
    `${f.base}/performer-options?occurred_at=${occurred_at}&lang=en&limit=2`,
    `${f.base}/recording-context`,
  ]) {
    const response = await f.h.app.inject({ method: 'GET', url, headers });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');
  }
});
