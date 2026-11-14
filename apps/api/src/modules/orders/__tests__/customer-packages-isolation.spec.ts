import { afterAll, beforeAll, expect, it } from 'vitest';
import { customerPackagePage } from '@pospay/contracts';
import { must, type SessionFixture } from './session.fixture.ts';
import {
  CustomerPackageReadError,
  CustomerPackagesQueryHandler,
  type CustomerPackageScope,
} from '../queries/customer-packages.query.ts';
import { CustomerPackageDetailQueryHandler } from '../queries/package-entitlement-detail.query.ts';
import {
  isolationScenarioFixture,
  type IsolationScenarioFixtureResult,
} from './customer-packages-scenarios.fixture.ts';

let fixture: IsolationScenarioFixtureResult;
let f: SessionFixture;
let listHandler: CustomerPackagesQueryHandler;
let detailHandler: CustomerPackageDetailQueryHandler;

beforeAll(async () => {
  fixture = await isolationScenarioFixture();
  f = fixture.f;
  const reads = { place: async () => 'Asia/Kuwait' };
  listHandler = new CustomerPackagesQueryHandler(f.db, reads, f.clock);
  detailHandler = new CustomerPackageDetailQueryHandler(f.db, { place: async () => 'Asia/Kuwait', canExtend: async () => false }, f.clock);
});

afterAll(async () => {
  await f?.close();
});

it('isolates packages between businesses for the same customer over HTTP', async () => {
  // مالك الشركة يملك تفويضاً على كامل فروع وأنشطة الشركة
  const path1 = `/v1/businesses/${f.business}/branches/${f.branch}/customers/${f.customer}/packages`;
  const res1 = await f.h.send('GET', path1, { cookie: f.ownerCookie, company: f.company });
  expect(res1.status).toBe(200);
  const page1 = customerPackagePage.parse(res1.body);
  expect(page1.items.some((i) => i.id === fixture.pkgBusiness1)).toBe(true);
  expect(page1.items.some((i) => i.id === fixture.pkgBusiness2)).toBe(false);

  const path2 = `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/customers/${f.customer}/packages`;
  const res2 = await f.h.send('GET', path2, { cookie: f.ownerCookie, company: f.company });
  expect(res2.status).toBe(200);
  const page2 = customerPackagePage.parse(res2.body);
  expect(page2.items.some((i) => i.id === fixture.pkgBusiness2)).toBe(true);
  expect(page2.items.some((i) => i.id === fixture.pkgBusiness1)).toBe(false);
});

it('returns 404 PACKAGE_NOT_FOUND with empty data when requesting other-business package in detail', async () => {
  const mismatchedDetailPath = `/v1/businesses/${f.business}/branches/${f.branch}/customers/${f.customer}/packages/${fixture.pkgBusiness2}`;
  const res = await f.h.send('GET', mismatchedDetailPath, { cookie: f.ownerCookie, company: f.company });
  expect(res.status).toBe(404);
  expect(res.body['code']).toBe('PACKAGE_NOT_FOUND');
  expect(res.body).not.toHaveProperty('components');
  expect(res.body).not.toHaveProperty('slots');
});

it('enforces company tenancy isolation at the query level for cross-tenant entitlement and customer', async () => {
  const ownScope: CustomerPackageScope = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: f.branch,
    customerId: f.customer,
  };

  // استعلام تفاصيل باقة من شركة أخرى بنطاق شركتنا يرمي PACKAGE_NOT_FOUND
  await expect(detailHandler.execute(ownScope, fixture.pkgOtherCompany, true)).rejects.toThrow(
    new CustomerPackageReadError('PACKAGE_NOT_FOUND'),
  );

  // استعلام باقات عميلة من شركة أخرى بنطاق شركتنا يرجع قائمة فارغة
  const foreignCustomerList = await listHandler.execute(
    { ...ownScope, customerId: fixture.foreignCustomer },
    { limit: 20 },
  );
  expect(foreignCustomerList.items).toEqual([]);
});

it('binds the cursor to business scope, rejecting cross-business replay in query and HTTP', async () => {
  const scopeBus1: CustomerPackageScope = {
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: f.branch,
    customerId: f.customer,
  };
  const scopeBus2: CustomerPackageScope = {
    ...scopeBus1,
    businessId: f.secondBusiness,
    branchId: f.secondBranch,
  };

  // إصدار مؤشر تحت النشاط الأول
  const page1 = await listHandler.execute(scopeBus1, { limit: 1 });
  const cursor = must(page1.next_cursor);

  // إعادة استخدام نفس المؤشر لنفس العميلة تحت النشاط الثاني مرفوض في الاستعلام
  await expect(listHandler.execute(scopeBus2, { limit: 1, cursor })).rejects.toThrow(
    new RangeError('CUSTOMER_PACKAGES_CURSOR_INVALID'),
  );

  // وعبر HTTP يُترجم إلى 400 VALIDATION_FAILED
  const httpRes = await f.h.send(
    'GET',
    `/v1/businesses/${f.secondBusiness}/branches/${f.secondBranch}/customers/${f.customer}/packages?cursor=${cursor}`,
    { cookie: f.ownerCookie, company: f.company },
  );
  expect(httpRes.status).toBe(400);
  expect(httpRes.body['code']).toBe('VALIDATION_FAILED');
});
