import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
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

const permission = 'read:service-sessions:branch';
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

async function role(code: string, scope = 'BRANCH', scopeId = f.branch) {
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.membership}`;
  await f.h.owner`UPDATE memberships SET role_id=${must(SYSTEM_ROLES.find((r) => r.code === code)).id},scope_type=${scope},scope_id=${scopeId},ends_at=NULL
    WHERE company_id=${f.company} AND id=${f.membership}`;
}

async function override(effect: string, expires: string | null = null) {
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,expires_at,reason,granted_by)
    VALUES(${f.company},${ids.newId()},${f.membership},${permission},${effect},'BRANCH',${f.branch},${expires},'Synthetic read access test',${f.ownerId})`;
}

it('enforces the access matrix across roles, overrides, scope, tenancy and feature flag', async () => {
  // كعكة الاستقبال بها صلاحية record:service-sessions:branch فتمر بنجاح 200
  expect((await getList()).status).toBe(200);

  // موظفة بلا صلاحيات وصول → 403
  await role('staff');
  expect((await getList()).status).toBe(403);

  // تجاوز صريح بالسماح لـ read:service-sessions:branch → 200
  await override('ALLOW');
  expect((await getList()).status).toBe(200);

  // تجاوز صريح بالمنع DENY → 403
  await override('DENY');
  expect((await getList()).status).toBe(403);

  // استعادة دور الصراف للاختبارات التالية
  await role('cashier');
  expect((await getList()).status).toBe(200);

  // عضوية منتهية → 403
  await f.h.owner`UPDATE memberships SET ends_at=now() WHERE company_id=${f.company} AND id=${f.membership}`;
  expect((await getList()).status).toBe(403);
  await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.membership}`;

  // نشاط آخر أو فرع آخر خارج النطاق → 403
  expect((await getList('', f.cookie, f.company, basePath(f.secondBusiness, f.branch))).status).toBe(403);
  expect((await getList('', f.cookie, f.company, basePath(f.business, f.secondBranch))).status).toBe(403);

  // فرع غير معروف → 403
  expect((await getList('', f.cookie, f.company, basePath(f.business, ids.newId()))).status).toBe(403);

  // شركة أخرى مختارة في الـ header → 403
  expect((await getList('', f.cookie, f.otherCompany)).status).toBe(403);

  // تعطيل ميزة الطلبات orders → 403 مع رمز FEATURE_DISABLED
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic feature disable test',${f.ownerId})`;
  const disabled = await getList();
  expect(disabled.status).toBe(403);
  expect(disabled.body['code']).toBe('FEATURE_DISABLED');
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  expect((await getList()).status).toBe(200);
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
