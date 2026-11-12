import { afterAll, beforeAll, expect, it } from 'vitest';
import { customerPackageDetail, customerPackagePage } from '@pospay/contracts';
import { ids, must, type SessionFixture } from './session.fixture.ts';
import { customerPackagesFixture } from './customer-packages.fixture.ts';

let fixture: Awaited<ReturnType<typeof customerPackagesFixture>>;
let f: SessionFixture;

beforeAll(async () => {
  fixture = await customerPackagesFixture();
  f = fixture.f;
});

afterAll(async () => {
  await f?.close();
});

const basePath = (businessId = f.business, branchId = f.branch, customerId = f.customer) =>
  `/v1/businesses/${businessId}/branches/${branchId}/customers/${customerId}/packages`;

const getList = (query = '', cookie = f.cookie, company = f.company, url = basePath()) =>
  f.h.send('GET', query ? `${url}?${query}` : url, { cookie, company });

const getDetail = (
  entitlementId: string,
  cookie = f.cookie,
  company = f.company,
  url = basePath(),
) => f.h.send('GET', `${url}/${entitlementId}`, { cookie, company });

it('rejects a year-zero cursor over HTTP with 400 VALIDATION_FAILED', async () => {
  const yearZeroCursor = Buffer.from(
    JSON.stringify({
      company_id: f.company,
      business_id: f.business,
      customer_id: f.customer,
      rank: 0,
      expires_on: '0000-01-01',
      id: fixture.packages.b,
    }),
  ).toString('base64url');
  const res = await getList(`cursor=${yearZeroCursor}`);
  expect(res.status).toBe(400);
  expect(res.body['code']).toBe('VALIDATION_FAILED');
});

it('rejects invalid query parameters: limit=0, limit=51, unknown key and malformed cursor with 400 VALIDATION_FAILED', async () => {
  for (const query of [
    'limit=0',
    'limit=51',
    'unknown=true',
    'cursor=invalid%20char',
    'cursor=bad+char',
  ]) {
    const res = await getList(query);
    expect(res.status).toBe(400);
    expect(res.body['code']).toBe('VALIDATION_FAILED');
  }
});

it('returns package detail with 200 and snake_case keys', async () => {
  const res = await getDetail(fixture.packages.a);
  expect(res.status).toBe(200);
  const detail = customerPackageDetail.parse(res.body);
  expect(detail.id).toBe(fixture.packages.a);
  expect(detail.customer_id).toBe(fixture.f.customer);
  expect(detail.price_paid).toBe('32.500');
  expect(detail.list_price).toBe('32.500');

  expect(Object.keys(res.body).sort()).toEqual(
    [
      'id',
      'customer_id',
      'package_type_id',
      'provenance',
      'name_en',
      'name_ar',
      'validity_days',
      'list_price',
      'price_paid',
      'discount',
      'discount_bps',
      'paid_method',
      'seller_employee_id',
      'seller_linked_user_id',
      'sold_branch_id',
      'sold_at',
      'sold_business_date',
      'expires_on',
      'refunded_amount',
      'revision',
      'components',
      'redemptions',
      'extensions',
    ].sort(),
  );

  const comp = must(detail.components[0]);
  expect(comp.component_value).toBe('32.500');
  expect(Object.keys(comp).sort()).toEqual(
    [
      'id',
      'service_id',
      'position',
      'name_en',
      'name_ar',
      'list_price_snapshot',
      'component_value',
      'sessions_total',
      'remaining',
      'used',
      'refunded',
      'slots',
    ].sort(),
  );

  const slot = must(comp.slots[0]);
  expect(Object.keys(slot).sort()).toEqual(['ordinal', 'state', 'unit_value'].sort());
});

it('returns 404 PACKAGE_NOT_FOUND with bilingual messages for unknown id, other customer entitlement, and mismatched customer path', async () => {
  // معرف غير موجود
  const unknownRes = await getDetail(ids.newId());
  expect(unknownRes.status).toBe(404);
  expect(unknownRes.body).toMatchObject({
    code: 'PACKAGE_NOT_FOUND',
    message_en: 'Package not found.',
    message_ar: 'الباقة مش موجودة.',
  });

  // باقة تخص عميلة أخرى عبر مسار العميلة الحالية
  const otherCustomerPkgRes = await getDetail(fixture.packages.f);
  expect(otherCustomerPkgRes.status).toBe(404);
  expect(otherCustomerPkgRes.body).toMatchObject({
    code: 'PACKAGE_NOT_FOUND',
    message_en: 'Package not found.',
    message_ar: 'الباقة مش موجودة.',
  });

  // نفس المعرف عبر مسار عميلة أخرى
  const mismatchedPathRes = await getDetail(
    fixture.packages.a,
    f.cookie,
    f.company,
    basePath(f.business, f.branch, fixture.otherCustomer),
  );
  expect(mismatchedPathRes.status).toBe(404);
  expect(mismatchedPathRes.body).toMatchObject({
    code: 'PACKAGE_NOT_FOUND',
    message_en: 'Package not found.',
    message_ar: 'الباقة مش موجودة.',
  });
});

it('does not leak customer phone number or any phone field in list or detail bodies', async () => {
  const listRes = await getList();
  expect(listRes.status).toBe(200);
  customerPackagePage.parse(listRes.body);
  const listJson = JSON.stringify(listRes.body);
  expect(listJson).not.toContain('phone');
  expect(listJson).not.toContain('+999999998123');

  const detailRes = await getDetail(fixture.packages.a);
  expect(detailRes.status).toBe(200);
  const detailJson = JSON.stringify(detailRes.body);
  expect(detailJson).not.toContain('phone');
  expect(detailJson).not.toContain('+999999998123');
});
