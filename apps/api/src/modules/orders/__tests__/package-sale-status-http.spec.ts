import type { ExecutionContext } from '@nestjs/common';
import { packageSaleStatus } from '@pospay/contracts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { ApiError } from '../../../shared/errors.ts';
import { PackageSalesController } from '../http/package-sales.controller.ts';
import { SessionAdminGuard } from '../http/session-access.guard.ts';
import { seedSoldPackage } from './package-extension.fixture.ts';
import {
  cleanPackageSales,
  completeSaleRequest,
  failSaleRequest,
  insertSaleRequestRow,
  packageSaleRequestFixture,
  saleStatusPath,
} from './package-sale-request.fixture.ts';
import { ids, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
let branchInSameBusiness: string;

beforeAll(async () => {
  f = (await packageSaleRequestFixture()).f;
  branchInSameBusiness = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${f.company},${branchInSameBusiness},${f.business},'Synthetic second branch')`;
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    SELECT ${f.otherCompany}, ${ids.newId()}, id, 'sell:packages:branch', 'ALLOW', 'COMPANY', ${f.otherCompany},
      NULL, 'Synthetic other company package sale grant', user_id
    FROM memberships
    WHERE company_id = ${f.otherCompany} AND user_id = ${f.userId}
    ON CONFLICT DO NOTHING`;
});

afterAll(async () => {
  await f?.close();
});

beforeEach(async () => {
  await cleanPackageSales(f);
});

it('returns 200 pending when the sale request is pending', async () => {
  const saleRequestId = await insertSaleRequestRow(f);
  const response = await f.h.send('GET', saleStatusPath(f, saleRequestId), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'pending' });
  expect(packageSaleStatus.parse(response.body)).toEqual({ status: 'pending' });
});

it('returns 200 completed with entitlement and string money fields when finished', async () => {
  const seeded = await seedSoldPackage(f, { sessions: 2, expiresOn: '2026-12-30' });
  const saleRequestId = await insertSaleRequestRow(f);
  await completeSaleRequest(f, saleRequestId, seeded.entitlement);

  const response = await f.h.send('GET', saleStatusPath(f, saleRequestId), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(response.status).toBe(200);
  const parsed = packageSaleStatus.parse(response.body);
  expect(parsed.status).toBe('completed');
  if (parsed.status === 'completed') {
    expect(parsed.entitlement.id).toBe(seeded.entitlement);
    expect(parsed.entitlement.components).toHaveLength(1);
    expect(parsed.entitlement.components[0]?.id).toBe(seeded.component);
    expect(typeof parsed.entitlement.list_price).toBe('string');
    expect(typeof parsed.entitlement.price_paid).toBe('string');
    expect(typeof parsed.entitlement.discount).toBe('string');
    expect(typeof parsed.entitlement.refunded_amount).toBe('string');
    expect(typeof parsed.entitlement.components[0]?.list_price_snapshot).toBe('string');
    expect(typeof parsed.entitlement.components[0]?.component_value).toBe('string');
  }
});

it('returns 200 failed with catalogue error code, non-empty messages and passed-through details', async () => {
  const saleRequestId = await insertSaleRequestRow(f);
  const details = { rejected_service_id: f.services[0], reason: 'invalid_components' };
  await failSaleRequest(f, saleRequestId, 'PACKAGE_TYPE_INVALID_COMPONENTS', details);

  const response = await f.h.send('GET', saleStatusPath(f, saleRequestId), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(response.status).toBe(200);
  const parsed = packageSaleStatus.parse(response.body);
  expect(parsed.status).toBe('failed');
  if (parsed.status === 'failed') {
    expect(parsed.error.code).toBe('PACKAGE_TYPE_INVALID_COMPONENTS');
    expect(parsed.error.message_ar.length).toBeGreaterThan(0);
    expect(parsed.error.message_en.length).toBeGreaterThan(0);
    expect(parsed.error.details).toEqual(details);
  }
});

it('returns code PACKAGE_SALE_FAILED when the stored error code is LEGACY_UNKNOWN and never exposes the raw code', async () => {
  const saleRequestId = await insertSaleRequestRow(f);
  await failSaleRequest(f, saleRequestId, 'LEGACY_UNKNOWN');

  const response = await f.h.send('GET', saleStatusPath(f, saleRequestId), {
    cookie: f.cookie,
    company: f.company,
  });
  expect(response.status).toBe(200);
  const parsed = packageSaleStatus.parse(response.body);
  expect(parsed.status).toBe('failed');
  if (parsed.status === 'failed') {
    expect(parsed.error.code).toBe('PACKAGE_SALE_FAILED');
    expect(parsed.error.message_ar.length).toBeGreaterThan(0);
    expect(parsed.error.message_en.length).toBeGreaterThan(0);
  }
  expect(JSON.stringify(response.body)).not.toContain('LEGACY_UNKNOWN');
});

interface ScopingOverrides {
  cookie?: string;
  company?: string;
  businessId?: string;
  branchId?: string;
  saleRequestId?: string;
}

const notFound = 'PACKAGE_SALE_REQUEST_NOT_FOUND';

it.each([
  ['another user in the same company', 404, (): ScopingOverrides => ({ cookie: f.ownerCookie })],
  [
    'same id under another branch path (no grant on that branch)',
    403,
    (): ScopingOverrides => ({ branchId: branchInSameBusiness }),
  ],
  [
    'another business path (no grant there)',
    403,
    (): ScopingOverrides => ({
      businessId: f.secondBusiness,
      branchId: f.secondBranch,
    }),
  ],
  [
    'another company',
    404,
    (): ScopingOverrides => ({
      company: f.otherCompany,
      businessId: f.foreignBusiness,
      branchId: f.foreignBranch,
    }),
  ],
  ['an unknown uuid', 404, (): ScopingOverrides => ({ saleRequestId: ids.newId() })],
])('refuses %s with status %s and never returns the request', async (_scenario, status, getOverrides) => {
  const saleRequestId = await insertSaleRequestRow(f);
  const overrides = getOverrides();
  const idToQuery = overrides.saleRequestId ?? saleRequestId;
  const path = saleStatusPath(f, idToQuery, overrides.businessId, overrides.branchId);
  const response = await f.h.send('GET', path, {
    cookie: overrides.cookie ?? f.cookie,
    company: overrides.company ?? f.company,
  });
  expect(response.status).toBe(status);
  expect(response.body).not.toHaveProperty('status');
  if (status === 404) expect(response.body).toMatchObject({ code: notFound });
});

it('refuses a device principal at the route guard', () => {
  const context = (kind: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ principal: { kind } }) }),
    }) as unknown as ExecutionContext;
  expect(() => new SessionAdminGuard().canActivate(context('device'))).toThrow(ApiError);
  expect(new SessionAdminGuard().canActivate(context('user'))).toBe(true);
  const guards: unknown[] =
    Reflect.getMetadata('__guards__', PackageSalesController.prototype.status) ?? [];
  expect(guards).toContain(SessionAdminGuard);
});

it('refuses a request with 403 without sell:packages:branch', async () => {
  const saleRequestId = await insertSaleRequestRow(f);
  const outsiderCookie = await f.h.signedInOperator('no-package-sale-status@example.test');
  const response = await f.h.send('GET', saleStatusPath(f, saleRequestId), {
    cookie: outsiderCookie,
    company: f.company,
  });
  expect(response.status).toBe(403);
});
