import type { ExecutionContext } from '@nestjs/common';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { PackageSaleContextController } from '../http/package-sale-context.controller.ts';
import { SessionAdminGuard } from '../http/session-access.guard.ts';
import {
  cleanPackageSales,
  packageSaleRequestFixture,
  postSale,
  readSaleRequests,
  saleBody,
} from './package-sale-request.fixture.ts';
import { AT, ids, must, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => {
  f = (await packageSaleRequestFixture()).f;
});
afterAll(async () => {
  await f?.close();
});

const base = (businessId = f.business, branchId = f.branch) =>
  `/v1/businesses/${businessId}/branches/${branchId}/package-sales`;
const read = (
  suffix = 'context',
  cookie = f.cookie,
  company = f.company,
  businessId = f.business,
  branchId = f.branch,
) => f.h.send('GET', `${base(businessId, branchId)}/${suffix}`, { cookie, company });
const sellerRead = () =>
  read(`seller-options?lang=en&occurred_at=${encodeURIComponent(AT.toISOString())}`);

async function role(code: string, scopeType = 'BRANCH', scopeId = f.branch) {
  await f.h
    .owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((entry) => entry.code === code)).id},
    role_owner_key='global',scope_type=${scopeType},scope_id=${scopeId},ends_at=NULL
    WHERE company_id=${f.company} AND id=${f.membership}`;
}

async function deny(permission: string) {
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},${permission},'DENY','BRANCH',${f.branch},
      'Synthetic package context denial',${f.ownerId})`;
}

async function clearOverrides() {
  await f.h.owner`DELETE FROM permission_overrides
    WHERE company_id=${f.company} AND membership_id=${f.membership}
      AND (permission_code<>'sell:packages:branch' OR effect='DENY')`;
}

it('allows a seller without recording or performer-change authority and keeps DENY effective', async () => {
  await role('cashier');
  await deny('record:service-sessions:branch');
  await deny('change:service-line-performers:branch');
  try {
    expect((await read()).status).toBe(200);
    expect((await sellerRead()).status).toBe(200);
    await deny('sell:packages:branch');
    expect((await read()).status).toBe(403);
    expect((await sellerRead()).status).toBe(403);
  } finally {
    await clearOverrides();
  }
});

it('refuses an expired recorder membership on both reads', async () => {
  await f.h.owner`UPDATE memberships SET starts_at='2025-12-31T00:00:00Z',
    ends_at='2026-01-01T00:00:00Z'
    WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    expect((await read()).status).toBe(403);
    expect((await sellerRead()).status).toBe(403);
  } finally {
    await f.h.owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z',ends_at=NULL
      WHERE company_id=${f.company} AND id=${f.membership}`;
  }
});

it('checks permission before feature and reports a disabled feature only to an allowed seller', async () => {
  const outsider = await f.h.signedInOperator('package-context-outsider@example.test');
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic package context feature',${f.ownerId})`;
  try {
    expect((await read('context', outsider)).body['code']).toBe('FORBIDDEN');
    expect((await read()).body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
});

it('accepts the explicitly selected sale-eligible recorder membership', async () => {
  const second = ids.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT company_id,${second},user_id,role_id,role_owner_key,scope_type,scope_id,'2026-01-01'
    FROM memberships WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const response = await postSale(f, {
      body: saleBody(f, { recorder_membership_id: second }),
    });
    expect(response.status).toBe(202);
    expect((await readSaleRequests(f))[0]?.['recorded_by_membership_id']).toBe(second);
  } finally {
    await cleanPackageSales(f);
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id=${second}`;
  }
});

it('declares the admin guard on both reads and refuses a device principal', () => {
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ principal: { kind: 'device' } }) }),
  } as unknown as ExecutionContext;
  expect(() => new SessionAdminGuard().canActivate(context)).toThrow(ApiError);
  for (const method of ['context', 'sellers'] as const) {
    const guards: unknown[] =
      Reflect.getMetadata('__guards__', PackageSaleContextController.prototype[method]) ?? [];
    expect(guards).toContain(SessionAdminGuard);
  }
});

it('refuses foreign and mismatched places uniformly on both sale reads', async () => {
  for (const suffix of [
    'context',
    `seller-options?lang=en&occurred_at=${encodeURIComponent(AT.toISOString())}`,
  ]) {
    for (const response of [
      await read(suffix, f.ownerCookie, f.otherCompany),
      await read(suffix, f.ownerCookie, f.company, f.secondBusiness, f.branch),
      await read(suffix, f.ownerCookie, f.company, f.foreignBusiness, f.foreignBranch),
      await read(suffix, f.ownerCookie, f.company, f.business, ids.newId()),
    ]) {
      expect(response.status).toBe(403);
    }
  }
});

it.each([
  ['general_manager', 'COMPANY', 'company'],
  ['business_manager', 'BUSINESS', 'business'],
] as const)('default %s uses the real %s customer guard', async (code, scopeType, route) => {
  await role(code, scopeType, scopeType === 'COMPANY' ? f.company : f.business);
  const body = {
    name: `Synthetic ${route} customer`,
    phone: { calling_code: '999', national_number: route === 'company' ? '00000041' : '00000042' },
    locale: 'en',
    gender: 'female' as const,
  };
  try {
    expect((await read()).body['customer_entry_scope']).toBe(route);
    const path =
      route === 'company'
        ? '/v1/customers/find-or-create'
        : `/v1/businesses/${f.business}/customers/find-or-create`;
    const response = await f.h.send('POST', path, { cookie: f.cookie, company: f.company, body });
    expect(response.status).toBe(200);
    if (route === 'company') {
      expect(
        (
          await f.h.send('POST', `/v1/branches/${f.branch}/customers/find-or-create`, {
            cookie: f.cookie,
            company: f.company,
            body,
          })
        ).status,
      ).toBe(403);
    }
  } finally {
    await role('cashier');
  }
});

it('uses branch customer authority independently of a company sale membership', async () => {
  const roleId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES(${roleId},${f.company},'synthetic_package_seller','Synthetic package seller')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${roleId},${f.company},${f.company},'sell:packages:branch'),
          (${roleId},${f.company},${f.company},'create:customers:branch')`;
  await f.h.owner`UPDATE memberships SET role_id=${roleId},role_owner_key=${f.company},
    scope_type='COMPANY',scope_id=${f.company}
    WHERE company_id=${f.company} AND id=${f.membership}`;
  try {
    const allowed = await read();
    expect(allowed.status).toBe(200);
    expect(allowed.body['customer_entry_scope']).toBe('branch');
    await deny('create:customers:branch');
    const denied = await read();
    expect(denied.status).toBe(200);
    expect(denied.body['customer_entry_scope']).toBeNull();
  } finally {
    await clearOverrides();
    await role('cashier');
    await f.h.owner`DELETE FROM roles WHERE company_id=${f.company} AND id=${roleId}`;
  }
});
