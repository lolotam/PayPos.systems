import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  approvedDeviceToken,
  closeCommissionFixture,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  overrideAndAuditCounts,
  overrideInput,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';

let f: CommissionServiceOverrideFixture;
beforeEach(async () => {
  f = await commissionServiceOverridesFixture();
});
afterEach(async () => {
  await closeCommissionFixture(f);
});

it('CM-10 a member without the commission permission is refused on both routes', async () => {
  const member = await memberWithoutPlanPermission(f);
  const before = await overrideAndAuditCounts(f);
  const created = await f.postOverride(overrideInput(f), 'cm-access-no-permission', f.employee, member.cookie);
  const listed = await f.getOverrides('', f.employee, member.cookie);
  expect([created.status, created.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect([listed.status, listed.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect(await overrideAndAuditCounts(f)).toEqual(before);
});

it('CM-10 a real device principal is refused on both routes', async () => {
  const token = await approvedDeviceToken(f);
  const before = await overrideAndAuditCounts(f);
  const created = await f.h.app.inject({
    method: 'POST',
    url: f.overridePath(f.business, f.employee),
    headers: {
      authorization: `Device ${token}`,
      'x-company-id': f.company,
      'idempotency-key': 'cm-access-device',
    },
    payload: overrideInput(f),
  });
  const listed = await f.h.app.inject({
    method: 'GET',
    url: f.overridePath(f.business, f.employee),
    headers: { authorization: `Device ${token}`, 'x-company-id': f.company },
  });
  expect(created.statusCode).toBe(403);
  expect(listed.statusCode).toBe(403);
  expect(await overrideAndAuditCounts(f)).toEqual(before);
});

it('CM-10 a disabled commissions feature refuses both routes with FEATURE_DISABLED', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'commissions',false,'Synthetic disabled',${f.userId})`;
  try {
    const created = await f.postOverride(overrideInput(f), 'cm-access-feature-off');
    const listed = await f.getOverrides();
    expect([created.status, created.body['code']]).toEqual([403, 'FEATURE_DISABLED']);
    expect([listed.status, listed.body['code']]).toEqual([403, 'FEATURE_DISABLED']);
    expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides
      WHERE company_id=${f.company} AND flag='commissions'`;
  }
});

it('CM-10 an anonymous request is refused by the session guard before the route', async () => {
  const created = await f.h.app.inject({
    method: 'POST',
    url: f.overridePath(f.business, f.employee),
    headers: { 'x-company-id': f.company, 'idempotency-key': 'cm-access-anonymous' },
    payload: overrideInput(f),
  });
  const listed = await f.h.app.inject({
    method: 'GET',
    url: f.overridePath(f.business, f.employee),
    headers: { 'x-company-id': f.company },
  });
  expect(created.statusCode).toBe(401);
  expect(listed.statusCode).toBe(401);
  expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
});

it('CM-10 the employee of another business or another company is not found, not leaked', async () => {
  const otherBusiness = await f.h.app.inject({
    method: 'GET',
    url: f.overridePath(f.otherBusiness, f.employee),
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect([otherBusiness.statusCode, (otherBusiness.json() as { code: string }).code]).toEqual([
    404,
    'EMPLOYEE_NOT_FOUND',
  ]);
  const otherCompany = await f.h.app.inject({
    method: 'GET',
    url: f.overridePath(f.otherBusiness, f.employee),
    headers: { cookie: f.cookie, 'x-company-id': f.otherCompany },
  });
  // النشاط ده مش تابع للشركة المطلوبة، فالحارس يرفض قبل أي قراءة.
  expect([otherCompany.statusCode, (otherCompany.json() as { code: string }).code]).toEqual([
    403,
    'FORBIDDEN',
  ]);
  expect(await overrideAndAuditCounts(f)).toEqual([0, 0]);
});
