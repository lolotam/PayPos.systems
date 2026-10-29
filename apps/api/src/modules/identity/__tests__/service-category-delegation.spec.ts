import { service, serviceCategory, servicePage } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  newHeldMember,
  newMember,
  permissionFixture,
  save,
  type PermissionFixture,
} from '../../identity/__tests__/permissions-screen.fixture.ts';

let f: PermissionFixture;
let branchCashier: { cookie: string; membership: string };
beforeAll(async () => {
  f = await permissionFixture();
  branchCashier = await staffActor('cashier', 'BRANCH', f.branch);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

/** موظف بدور نظام حيّ: جلسة حقيقية وعضوية على فرع؛ المنح الشخصي بيجي بنطاقه هو. */
async function staffActor(code: string, scopeType: 'BUSINESS' | 'BRANCH', scopeId: string) {
  const email = `catalog-delegation-${code}-${f.ids.newId()}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const membership = await newHeldMember(f, { userId: user?.['id'] as string }, code);
  await f.h.owner`UPDATE memberships SET scope_type=${scopeType},scope_id=${scopeId}
    WHERE company_id=${f.company} AND id=${membership}`;
  return { cookie, membership };
}

/** منحة المالك من شاشة الصلاحيات: نفس الطريق الحقيقي، والنطاق بيتحقق منه الخادم. */
const grant = (
  membership: string,
  permission_code: string,
  scope_type: 'BUSINESS' | 'BRANCH',
  scope_id: string,
) => save(f, membership, { permission_code, scope_type, scope_id });

const serviceBody = (name_en: string) => ({
  name_en,
  name_ar: 'خدمة مفوّضة',
  price: '12.500',
  commission_rule: { kind: 'FOLLOW_PLAN' as const },
  counts_toward_threshold: true,
});

it('DEL-01 a branch cashier delegated the branch category codes creates a category in that branch', async () => {
  for (const permission_code of [
    'manage:service-categories:branch',
    'read:service-categories:branch',
  ]) {
    const granted = await grant(branchCashier.membership, permission_code, 'BRANCH', f.branch);
    expect(granted.status).toBe(201);
  }
  const response = await f.h.send(
    'POST',
    `/v1/businesses/${f.business}/branches/${f.branch}/service-categories`,
    {
      cookie: branchCashier.cookie,
      company: f.company,
      body: { name_en: 'Delegated category', name_ar: 'تصنيف مفوّض', visibility: 'BRANCH' },
    },
  );
  expect(response.status).toBe(201);
  const record = serviceCategory.parse(response.body);
  expect(record).toMatchObject({
    name_en: 'Delegated category',
    name_ar: 'تصنيف مفوّض',
    visibility: 'BRANCH',
    owner_branch_id: f.branch,
    revision: 1,
    closed_at: null,
  });
  expect(
    await f.h.owner`SELECT name_en,visibility,owner_branch_id,revision FROM service_categories
      WHERE company_id=${f.company} AND id=${record.id}`,
  ).toEqual([
    {
      name_en: 'Delegated category',
      visibility: 'BRANCH',
      owner_branch_id: f.branch,
      revision: 1,
    },
  ]);
});

it('DEL-02 a branch cashier granted the service codes business-wide creates and reads back a service', async () => {
  for (const permission_code of ['manage:services:business', 'read:services:business']) {
    const granted = await grant(branchCashier.membership, permission_code, 'BUSINESS', f.business);
    expect(granted.status).toBe(201);
  }
  const created = await f.h.send('POST', `/v1/businesses/${f.business}/services`, {
    cookie: branchCashier.cookie,
    company: f.company,
    body: serviceBody('Delegated service'),
  });
  expect(created.status).toBe(201);
  const record = service.parse(created.body);
  expect(record).toMatchObject({
    business_id: f.business,
    name_en: 'Delegated service',
    price: '12.500',
    revision: 1,
  });
  const detail = await f.h.send('GET', `/v1/businesses/${f.business}/services/${record.id}`, {
    cookie: branchCashier.cookie,
    company: f.company,
  });
  expect(detail.status).toBe(200);
  expect(service.parse(detail.body)).toMatchObject({ id: record.id, name_en: 'Delegated service' });
  const listed = await f.h.send('GET', `/v1/businesses/${f.business}/services`, {
    cookie: branchCashier.cookie,
    company: f.company,
  });
  expect(listed.status).toBe(200);
  expect(servicePage.parse(listed.body).items.map((item) => item.id)).toContain(record.id);
  expect(
    await f.h.owner`SELECT name_en,price::text FROM services
      WHERE company_id=${f.company} AND id=${record.id}`,
  ).toEqual([{ name_en: 'Delegated service', price: '12.500' }]);
});

it('DEL-04 a device is never granted any of the six delegated catalog codes', async () => {
  const device = await newMember(f, 'device');
  const before = await f.h.owner`SELECT count(*)::int AS n FROM permission_overrides
    WHERE company_id=${f.company}`;
  for (const permission_code of [
    'read:service-categories:business',
    'manage:service-categories:business',
    'read:service-categories:branch',
    'manage:service-categories:branch',
    'manage:services:business',
    'read:services:business',
  ]) {
    const refused = await save(f, device, {
      permission_code,
      scope_type: 'BUSINESS',
      scope_id: f.business,
    });
    expect(refused.status).toBe(403);
    expect(refused.body['code']).toBe('PERMISSION_ROLE_FORBIDDEN');
  }
  expect(
    await f.h.owner`SELECT count(*)::int AS n FROM permission_overrides
      WHERE company_id=${f.company}`,
  ).toEqual(before);
});
