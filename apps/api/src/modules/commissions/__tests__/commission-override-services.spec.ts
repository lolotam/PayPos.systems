import { afterAll, beforeAll, expect, it } from 'vitest';

import { commissionOverrideServicesStatement } from '../../../../test/harness.ts';
import {
  approvedDeviceToken,
  closeCommissionFixture,
  ids,
  memberWithoutPlanPermission,
} from './commission-plan-versions.fixture.ts';
import {
  businessToday,
  commissionServiceOverridesFixture,
  seedOverride,
  shiftDate,
  type CommissionServiceOverrideFixture,
} from './commission-service-overrides.fixture.ts';
import {
  commissionOverrideCurrentStatement,
  listCommissionOverrideServices,
} from '../queries/commission-override-services.query.ts';

let f: CommissionServiceOverrideFixture;
let today: string;

beforeAll(async () => {
  f = await commissionServiceOverridesFixture();
  today = await businessToday(f);
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

type OverrideServicesBody = {
  items: Record<string, unknown>[];
  next_cursor: string | null;
};

async function seedService(patch: {
  nameEn: string;
  nameAr?: string | null;
  price?: string;
  ruleKind?: 'FOLLOW_PLAN' | 'ZERO' | 'PCT' | 'FIXED';
  pctBps?: number | null;
  closedAt?: string | null;
}): Promise<string> {
  const service = ids.newId();
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,name_ar,price,
      commission_rule_kind,commission_pct_bps,closed_at)
    VALUES (${f.company},${service},${f.business},${patch.nameEn},${patch.nameAr ?? null},
      ${patch.price ?? '10.000'},${patch.ruleKind ?? 'ZERO'},${patch.pctBps ?? null},
      ${patch.closedAt ?? null})`;
  return service;
}

async function grantPlanPermission(membershipId: string): Promise<void> {
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    SELECT role_id,role_owner_key,company_id,'manage:commission-plans:business' FROM memberships
    WHERE company_id=${f.company} AND id=${membershipId}`;
}

it('FR-013a the plan permission alone lists every service with its catalog rule and price', async () => {
  const pctService = await seedService({
    nameEn: 'Keratin',
    nameAr: 'فرد',
    price: '25.500',
    ruleKind: 'PCT',
    pctBps: 1000,
  });
  const member = await memberWithoutPlanPermission(f);
  await grantPlanPermission(member.membershipId);
  const listed = await f.getOverrideServices('', f.business, member.cookie);
  expect(listed.status).toBe(200);
  const body = listed.body as unknown as OverrideServicesBody;
  const byService = new Map(body.items.map((item) => [item['service_id'], item]));
  expect(byService.get(pctService)).toEqual({
    service_id: pctService,
    name_en: 'Keratin',
    name_ar: 'فرد',
    closed_at: null,
    service_rule: { kind: 'PCT', value: 1000 },
    price: '25.500',
    current_override: null,
  });
  expect(byService.get(f.service)).toMatchObject({
    service_id: f.service,
    name_en: 'Override service',
    price: '10.000',
    current_override: null,
  });
  expect(Object.keys(byService.get(pctService) as object).sort()).toEqual([
    'closed_at',
    'current_override',
    'name_ar',
    'name_en',
    'price',
    'service_id',
    'service_rule',
  ]);
  // صلاحية الخطط لوحدها بتكفي القايمة دي، وقائمة الخدمات نفسها لسه مقفولة عليها.
  const catalog = await f.h.send('GET', `/v1/businesses/${f.business}/services`, {
    cookie: member.cookie,
    company: f.company,
  });
  expect([catalog.status, catalog.body['code']]).toEqual([403, 'FORBIDDEN']);
});

it('CM-12 current_override is exactly the row the overrides list marks is_current', async () => {
  await seedOverride(f, {
    effectiveFrom: today,
    createdAt: '2026-11-01T09:00:00.000001Z',
    ruleKind: 'PCT',
    pctBps: 500,
  });
  const newer = await seedOverride(f, {
    effectiveFrom: today,
    createdAt: '2026-11-02T09:00:00.000001Z',
    ruleKind: 'FIXED',
    fixedAmount: '3.000',
  });
  await seedOverride(f, { effectiveFrom: shiftDate(today, 1), createdAt: '2026-11-03T09:00:00.000001Z' });
  const listed = await f.getOverrideServices();
  const body = listed.body as unknown as OverrideServicesBody;
  const current = body.items.find((item) => item['service_id'] === f.service) as {
    current_override: { id: string } | null;
  };
  expect(current.current_override?.id).toBe(newer);
  const history = await f.getOverrides(`?service_id=${f.service}`);
  const marked = (history.body['items'] as { id: string; is_current: boolean }[]).filter(
    (row) => row.is_current,
  );
  expect(marked.map((row) => row.id)).toEqual([newer]);
});

it('CM-12 a service with no eligible override answers null, never a rule', async () => {
  const service = await seedService({ nameEn: 'No override service' });
  const listed = await f.getOverrideServices();
  const body = listed.body as unknown as OverrideServicesBody;
  const item = body.items.find((entry) => entry['service_id'] === service) as {
    current_override: unknown;
  };
  expect(item.current_override).toBeNull();
});

it('CS-Q50 a closed service stays listed with closed_at and its override is returned', async () => {
  const closed = await seedService({
    nameEn: 'Closed service',
    closedAt: '2026-01-15T10:00:00.000Z',
  });
  const saved = await seedOverride(f, {
    serviceId: closed,
    effectiveFrom: today,
    createdAt: '2026-11-01T09:00:00.000001Z',
    ruleKind: 'PCT',
    pctBps: 2000,
  });
  const listed = await f.getOverrideServices();
  const body = listed.body as unknown as OverrideServicesBody;
  const item = body.items.find((entry) => entry['service_id'] === closed) as {
    closed_at: string | null;
    current_override: { id: string } | null;
  };
  expect(item.closed_at).toBe('2026-01-15T10:00:00.000Z');
  expect(item.current_override?.id).toBe(saved);
});

it('the refusal order matches the overrides list: access, then feature, then employee', async () => {
  const member = await memberWithoutPlanPermission(f);
  await grantPlanPermission(member.membershipId);
  const scope = {
    companyId: f.company,
    userId: member.userId,
    businessId: f.business,
    employeeId: f.employee,
  };
  const list = () =>
    f.db.withTenant(f.company, (tx) =>
      listCommissionOverrideServices(tx, f.listReaders(tx), scope, { limit: 50 }),
    );
  const allowed = await f.getOverrideServices('', f.business, member.cookie);
  expect(allowed.status).toBe(200);
  await f.h.owner`DELETE FROM role_permissions
    WHERE company_id=${f.company} AND permission_code='manage:commission-plans:business'
      AND role_id=(SELECT role_id FROM memberships
        WHERE company_id=${f.company} AND id=${member.membershipId})`;
  await expect(list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await grantPlanPermission(member.membershipId);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'commissions',false,'Synthetic after guard',${f.userId})`;
  await expect(list()).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='commissions'`;
  const gone = structuredClone(scope);
  gone.employeeId = ids.newId();
  await expect(
    f.db.withTenant(f.company, (tx) =>
      listCommissionOverrideServices(tx, f.listReaders(tx), gone, { limit: 50 }),
    ),
  ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
});

it('a member without the plan permission, a device and a disabled feature are refused', async () => {
  const member = await memberWithoutPlanPermission(f);
  const refused = await f.getOverrideServices('', f.business, member.cookie);
  expect([refused.status, refused.body['code']]).toEqual([403, 'FORBIDDEN']);
  const token = await approvedDeviceToken(f);
  const device = await f.h.app.inject({
    method: 'GET',
    url: f.overrideServicesPath(f.business, f.employee),
    headers: { authorization: `Device ${token}`, 'x-company-id': f.company },
  });
  expect(device.statusCode).toBe(403);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'commissions',false,'Synthetic disabled',${f.userId})`;
  try {
    const disabled = await f.getOverrideServices();
    expect([disabled.status, disabled.body['code']]).toEqual([403, 'FEATURE_DISABLED']);
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='commissions'`;
  }
});

it('an unknown employee answers EMPLOYEE_NOT_FOUND and another business never leaks its rows', async () => {
  const unknown = await f.h.app.inject({
    method: 'GET',
    url: f.overrideServicesPath(f.business, ids.newId()),
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect([unknown.statusCode, (unknown.json() as { code: string }).code]).toEqual([
    404,
    'EMPLOYEE_NOT_FOUND',
  ]);
  const otherBusiness = await f.getOverrideServices('', f.otherBusiness);
  expect([otherBusiness.status, otherBusiness.body['code']]).toEqual([404, 'EMPLOYEE_NOT_FOUND']);
  const otherCompany = await f.h.app.inject({
    method: 'GET',
    url: f.overrideServicesPath(f.otherBusiness, f.employee),
    headers: { cookie: f.cookie, 'x-company-id': f.otherCompany },
  });
  expect([otherCompany.statusCode, (otherCompany.json() as { code: string }).code]).toEqual([
    403,
    'FORBIDDEN',
  ]);
});

it('pages follow the service id cursor with no repeats and refuse malformed input', async () => {
  const second = await seedService({ nameEn: 'Page service b' });
  const third = await seedService({ nameEn: 'Page service c' });
  const first = await f.getOverrideServices('?limit=2');
  const firstBody = first.body as unknown as OverrideServicesBody;
  expect(firstBody.items.map((item) => item['service_id'])).toEqual([f.service, second]);
  expect(firstBody.next_cursor).toBe(second);
  const secondPage = await f.getOverrideServices(`?limit=2&cursor=${second}`);
  const secondBody = secondPage.body as unknown as OverrideServicesBody;
  expect(secondBody.items.map((item) => item['service_id'])).toEqual([third]);
  expect(secondBody.next_cursor).toBeNull();
  const malformed = await f.h.app.inject({
    method: 'GET',
    url: `${f.overrideServicesPath(f.business, f.employee)}?cursor=not-a-uuid`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect([malformed.statusCode, (malformed.json() as { code: string }).code]).toEqual([
    400,
    'VALIDATION_FAILED',
  ]);
  const extra = await f.h.app.inject({
    method: 'GET',
    url: `${f.overrideServicesPath(f.business, f.employee)}?duration=30`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  expect([extra.statusCode, (extra.json() as { code: string }).code]).toEqual([
    400,
    'VALIDATION_FAILED',
  ]);
});

it('another company services and overrides never appear even with a forged scope', async () => {
  const listed = await f.getOverrideServices('?limit=100');
  const body = listed.body as unknown as OverrideServicesBody;
  const listedIds = body.items.map((item) => item['service_id']);
  expect(listedIds).not.toContain(f.otherBusinessService);
  expect(listedIds).not.toContain(f.otherTenantService);
  const scope = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    employeeId: f.employee,
  };
  const forgedServices = await f.db.withTenant(f.otherCompany, (tx) =>
    tx.execute(commissionOverrideServicesStatement(f.company, f.business, { limit: 20 })),
  );
  expect(Array.from(forgedServices)).toEqual([]);
  const forgedOverrides = await f.db.withTenant(f.otherCompany, (tx) =>
    tx.execute(commissionOverrideCurrentStatement(scope, [f.service], 'Asia/Kuwait')),
  );
  expect(Array.from(forgedOverrides)).toEqual([]);
});
