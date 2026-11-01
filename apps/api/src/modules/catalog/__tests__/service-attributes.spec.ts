import { createServiceInput, service } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  detailFor,
  grantServices,
  insertServiceCategories,
  servicesFixture,
  termsFor,
  type ServiceFixture,
} from './services.fixture.ts';

const ids = systemUuidV7();
let f: ServiceFixture;
let categories: Awaited<ReturnType<typeof insertServiceCategories>>;

beforeAll(async () => {
  f = await servicesFixture();
  await grantServices(f, f.business, 'manage:services:business');
  await grantServices(f, f.business, 'read:services:business');
  categories = await insertServiceCategories(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const post = (body: object, businessId = f.business) =>
  f.h.send('POST', `/v1/businesses/${businessId}/services`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const patch = (serviceId: string, body: object, businessId = f.business) =>
  f.h.app.inject({
    method: 'PATCH',
    url: `/v1/businesses/${businessId}/services/${serviceId}`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: body,
  });

/** تصنيف مفتوح إضافي في النشاط نفسه، عشان نقل الخدمة بين تصنيفين. */
const extraOpenCategory = async (nameEn: string) => {
  const id = ids.newId();
  await f.h
    .owner`INSERT INTO service_categories (company_id,id,business_id,name_en,name_ar,visibility)
    VALUES (${f.company},${id},${f.business},${nameEn},'تصنيف إضافي','BUSINESS')`;
  return id;
};

const fullBody = (patchBody: Record<string, unknown> = {}) => ({
  expected_revision: 1,
  name_en: 'Manicure',
  name_ar: null,
  price: '12.500',
  commission_rule: { kind: 'FOLLOW_PLAN' as const },
  counts_toward_threshold: true,
  ...patchBody,
});

const audits = async (serviceId: string) =>
  Number(
    (
      await f.h
        .owner`SELECT count(*)::int AS n FROM audit_log WHERE company_id=${f.company} AND entity='service' AND entity_id=${serviceId}`
    )[0]?.['n'] ?? 0,
  );

it('SV-A1 creates a service with a duration and a category, and audits both without the category names', async () => {
  const result = await post({
    ...termsFor('Manicure'),
    duration_minutes: 45,
    category_id: categories.open,
  });
  expect(result.status).toBe(201);
  const record = service.parse(result.body);
  expect(record).toMatchObject({
    duration_minutes: 45,
    category_id: categories.open,
    category: { name_en: 'Open category', name_ar: 'تصنيف مفتوح', closed_at: null },
  });
  const rows = await f.h.owner`SELECT after FROM audit_log
    WHERE company_id=${f.company} AND entity='service' AND entity_id=${record.id}`;
  const after = rows[0]?.['after'] as Record<string, unknown>;
  expect(after).toMatchObject({ duration_minutes: 45, category_id: categories.open });
  expect(after).not.toHaveProperty('category');
  expect(await detailFor(f, f.company, f.business, record.id)).toMatchObject({
    duration_minutes: 45,
    category_id: categories.open,
    category: { name_en: 'Open category', closed_at: null },
  });
});

it('SV-A2 a closed, a foreign or an unknown category is refused and nothing is inserted', async () => {
  const before = await f.h.owner`SELECT count(*) AS n FROM services`;
  const closed = await post({ ...termsFor('Closed'), category_id: categories.closed });
  expect(closed.status).toBe(409);
  expect(closed.body['code']).toBe('SERVICE_CATEGORY_CLOSED');
  const foreign = await post({ ...termsFor('Foreign'), category_id: categories.otherBusiness });
  expect(foreign.status).toBe(404);
  expect(foreign.body['code']).toBe('SERVICE_CATEGORY_NOT_FOUND');
  const unknown = await post({ ...termsFor('Unknown'), category_id: ids.newId() });
  expect(unknown.status).toBe(404);
  expect(unknown.body['code']).toBe('SERVICE_CATEGORY_NOT_FOUND');
  expect(await f.h.owner`SELECT count(*) AS n FROM services`).toEqual(before);
});

it('SV-A3 an update omitting both fields keeps them and writes no second audit row', async () => {
  const created = service.parse(
    (await post({ ...termsFor('Kept'), duration_minutes: 30, category_id: categories.open })).body,
  );
  const before = await audits(created.id);
  const response = await patch(created.id, fullBody({ name_en: 'Kept' }));
  expect(response.statusCode).toBe(200);
  expect(service.parse(response.json())).toMatchObject({
    duration_minutes: 30,
    category_id: categories.open,
    revision: 1,
  });
  expect(await audits(created.id)).toBe(before);
});

it('SV-A4 a null clears the duration and the category', async () => {
  const created = service.parse(
    (await post({ ...termsFor('Cleared'), duration_minutes: 30, category_id: categories.open }))
      .body,
  );
  const response = await patch(
    created.id,
    fullBody({ name_en: 'Cleared', duration_minutes: null, category_id: null }),
  );
  expect(response.statusCode).toBe(200);
  expect(service.parse(response.json())).toMatchObject({
    duration_minutes: null,
    category_id: null,
    category: null,
    revision: 2,
  });
});

it('SV-A5 a new category replaces the old one', async () => {
  const replacement = await extraOpenCategory('Replacement category');
  const created = service.parse(
    (await post({ ...termsFor('Moved'), category_id: categories.open })).body,
  );
  const response = await patch(
    created.id,
    fullBody({ name_en: 'Moved', category_id: replacement }),
  );
  expect(response.statusCode).toBe(200);
  expect(service.parse(response.json())).toMatchObject({
    category_id: replacement,
    category: { name_en: 'Replacement category', closed_at: null },
    revision: 2,
  });
});

it('SV-A6 moving to a closed category is refused', async () => {
  const created = service.parse(
    (await post({ ...termsFor('Closing'), category_id: categories.open })).body,
  );
  const response = await patch(
    created.id,
    fullBody({ name_en: 'Closing', category_id: categories.closed }),
  );
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'SERVICE_CATEGORY_CLOSED' });
});

it('SV-A7 a stale revision is refused before the category is touched', async () => {
  const created = service.parse(
    (await post({ ...termsFor('Stale'), category_id: categories.open })).body,
  );
  const response = await patch(
    created.id,
    fullBody({ name_en: 'Stale', expected_revision: 99, category_id: null }),
  );
  expect(response.statusCode).toBe(409);
  expect(response.json()).toMatchObject({ code: 'SERVICE_REVISION_CONFLICT' });
  expect(
    await f.h
      .owner`SELECT category_id FROM services WHERE company_id=${f.company} AND id=${created.id}`,
  ).toEqual([{ category_id: categories.open }]);
  // النسخة القديمة سبب الرفض الحقيقي، فالتصنيف المغلق ما يغطّيش التعارض.
  const closed = await patch(
    created.id,
    fullBody({ name_en: 'Stale', expected_revision: 99, category_id: categories.closed }),
  );
  expect(closed.statusCode).toBe(409);
  expect(closed.json()).toMatchObject({ code: 'SERVICE_REVISION_CONFLICT' });
  expect(
    await f.h
      .owner`SELECT category_id FROM services WHERE company_id=${f.company} AND id=${created.id}`,
  ).toEqual([{ category_id: categories.open }]);
});

it('SV-A8 a service of another tenant answers SERVICE_NOT_FOUND', async () => {
  const foreign = await f.create.execute({
    companyId: f.otherCompany,
    userId: f.userId,
    businessId: f.foreignBusiness,
    input: termsFor('Foreign tenant service'),
  });
  const response = await patch(foreign.id, fullBody({ name_en: 'Foreign tenant service' }));
  expect(response.statusCode).toBe(404);
  expect(response.json()).toMatchObject({ code: 'SERVICE_NOT_FOUND' });
});

it('SV-A9 the contract refuses a duration outside the whole-minute range', () => {
  for (const duration of [0, 601, 7.5]) {
    expect(
      createServiceInput.safeParse({ ...termsFor(), duration_minutes: duration }).success,
    ).toBe(false);
  }
  expect(createServiceInput.safeParse({ ...termsFor(), duration_minutes: 120 }).success).toBe(true);
});

it('SV-A10 an upper-case business id in the route still finds the category', async () => {
  const upper = f.business.toUpperCase();
  const replacement = await extraOpenCategory('Uppercase replacement');
  const created = await post(
    { ...termsFor('Uppercase business'), category_id: categories.open },
    upper,
  );
  expect(created.status).toBe(201);
  const record = service.parse(created.body);
  expect(record).toMatchObject({ category_id: categories.open });
  const updated = await patch(
    record.id,
    fullBody({ name_en: 'Uppercase business', category_id: replacement }),
    upper,
  );
  expect(updated.statusCode).toBe(200);
  expect(service.parse(updated.json())).toMatchObject({ category_id: replacement });
});

it('SV-A11 a service keeps a category that closed after it was assigned', async () => {
  const own = await extraOpenCategory('Closing after assignment');
  const created = service.parse(
    (await post({ ...termsFor('Kept closed'), category_id: own })).body,
  );
  await f.h.owner`UPDATE service_categories SET closed_at = now()
    WHERE company_id=${f.company} AND id=${own}`;
  const omitted = await patch(created.id, fullBody({ name_en: 'Kept closed renamed' }));
  expect(omitted.statusCode).toBe(200);
  const omittedRecord = service.parse(omitted.json());
  expect(omittedRecord).toMatchObject({ category_id: own, revision: 2 });
  expect(omittedRecord.category?.closed_at).not.toBeNull();
  const same = await patch(
    created.id,
    fullBody({
      name_en: 'Kept closed renamed twice',
      expected_revision: 2,
      category_id: own,
    }),
  );
  expect(same.statusCode).toBe(200);
  const sameRecord = service.parse(same.json());
  expect(sameRecord).toMatchObject({ category_id: own, revision: 3 });
  expect(sameRecord.category?.closed_at).not.toBeNull();
});
