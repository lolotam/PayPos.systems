import { afterEach, beforeEach, expect, it } from 'vitest';

import { listCommissionServiceOverrides } from '../queries/commission-service-overrides.query.ts';
import {
  approvedDeviceToken,
  closeCommissionFixture,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  commissionServiceOverridesFixture,
  overrideAndAuditCounts,
  overrideInput,
  seedOverride,
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
  const created = await f.postOverride(
    overrideInput(f),
    'cm-access-no-permission',
    f.employee,
    member.cookie,
  );
  const listed = await f.getOverrides('', f.employee, member.cookie);
  expect([created.status, created.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect([listed.status, listed.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect(await overrideAndAuditCounts(f)).toEqual(before);
});

it.each([
  { change: 'permission revoked', code: 'FORBIDDEN' },
  { change: 'feature disabled', code: 'FEATURE_DISABLED' },
])('the list rechecks access after the guard allowed it: $change', async ({ change, code }) => {
  const member = await memberWithoutPlanPermission(f);
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    SELECT role_id,role_owner_key,company_id,'manage:commission-plans:business' FROM memberships
    WHERE company_id=${f.company} AND id=${member.membershipId}`;
  const saved = await seedOverride(f, {
    effectiveFrom: '2026-10-01',
    createdAt: '2026-10-01T12:00:00.000001Z',
  });
  const scope = {
    companyId: f.company,
    userId: member.userId,
    businessId: f.business,
    employeeId: f.employee,
    serviceId: undefined,
  };
  const list = () =>
    f.db.withTenant(f.company, (tx) =>
      listCommissionServiceOverrides(tx, f.listReaders(tx), scope, { limit: 20 }),
    );
  const allowed = await f.getOverrides('', f.employee, member.cookie);
  expect([allowed.status, allowed.body['items']]).toEqual([
    200,
    expect.arrayContaining([expect.objectContaining({ id: saved })]),
  ]);
  // السماح قبل السحب لا يكفي: التغيير ده ملتزم قبل معاملة قراءة جديدة، بعد نقطة الحارس.
  if (change === 'permission revoked') {
    await f.h.owner`DELETE FROM role_permissions
      WHERE company_id=${f.company} AND permission_code='manage:commission-plans:business'
        AND role_id=(SELECT role_id FROM memberships
          WHERE company_id=${f.company} AND id=${member.membershipId})`;
  } else {
    await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
      VALUES (${f.company},'commissions',false,'Synthetic after guard',${f.userId})`;
  }
  await expect(list()).rejects.toMatchObject({ code });
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
