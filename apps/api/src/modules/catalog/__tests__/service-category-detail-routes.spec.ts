import { sql } from 'drizzle-orm';
import { recordServiceSessionResponse, serviceCategory, serviceCategoryDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { serviceCategoryDetailStatement } from '../queries/service-category-detail.query.ts';
import {
  ids as sessionIds,
  must,
  sessionFixture,
  type SessionFixture,
} from '../../../../test/service-session.fixture.ts';
import {
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

const ids = systemUuidV7();

let f: ServiceCategoryFixture;
let s: SessionFixture;

/** صلاحية إدارة الخدمات مش في مساعد التصنيفات، فبنمنحها للعضو نفسه. */
async function grantServicesPermission(fixture: ServiceCategoryFixture): Promise<void> {
  await fixture.h.owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${fixture.company},${ids.newId()},${fixture.memberId},'manage:services:business','ALLOW','BUSINESS',${fixture.business},'Synthetic grant',${fixture.userId})`;
}

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
  await grantServicesPermission(f);
  s = await sessionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
  await s?.close();
});

const createCategory = (body: object, business = f.business) =>
  f.h.send('POST', `/v1/businesses/${business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const readCategory = (categoryId: string, business = f.business) =>
  f.h.send('GET', `/v1/businesses/${business}/service-categories/${categoryId}`, {
    cookie: f.cookie,
    company: f.company,
  });
const closeCategory = (categoryId: string, body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/close`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const reopenCategory = (categoryId: string, body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/reopen`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const createService = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/services`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });

/** تصنيف بخدمة مفتوحة جواه، عشان أعداد التفاصيل تبقى مقروءة ومعناها. */
async function categoryWithService(name: string): Promise<string> {
  const created = await createCategory(namesFor(name));
  expect(created.status).toBe(201);
  const category = serviceCategory.parse(created.body);
  const service = await createService({
    name_en: `${name} service`,
    name_ar: null,
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    category_id: category.id,
  });
  expect(service.status).toBe(201);
  return category.id;
}

/** إغلاق خدمة من مسار الكتالوج: المالك هو اللي يحمل صلاحية القفل. */
const closeService = (serviceId: string) =>
  s.h.send('POST', `/v1/businesses/${s.business}/services/${serviceId}/close`, {
    cookie: s.ownerCookie,
    company: s.company,
    body: { expected_revision: 1 },
  });

it('the category detail shows the open category with the count of its open services', async () => {
  const categoryId = await categoryWithService('Open detail category');
  const response = await readCategory(categoryId);
  expect(response.status).toBe(200);
  expect(serviceCategoryDetail.parse(response.body)).toMatchObject({
    id: categoryId,
    name_en: 'Open detail category',
    visibility: 'BUSINESS',
    owner_branch_id: null,
    closed_at: null,
    revision: 1,
    open_service_count: 1,
    marked_service_count: 0,
  });
});

it('closing the category closes its services and the detail shows the closed category', async () => {
  const categoryId = await categoryWithService('Closed detail category');
  const before = serviceCategoryDetail.parse((await readCategory(categoryId)).body);
  const response = await closeCategory(categoryId, {
    expected_revision: before.revision,
    expected_service_count: before.open_service_count,
  });
  expect(response.status).toBe(200);
  expect(response.body['closed_at']).toEqual(expect.any(String));
  expect(response.body['services_closed']).toBe(1);
  const after = serviceCategoryDetail.parse((await readCategory(categoryId)).body);
  expect(after.closed_at).toEqual(expect.any(String));
  expect(after.open_service_count).toBe(0);
  expect(after.marked_service_count).toBe(1);
  expect(after.revision).toBe(before.revision + 1);
});

it('reopening the category opens it with its services and the detail shows the open category again', async () => {
  const categoryId = await categoryWithService('Reopened detail category');
  const before = serviceCategoryDetail.parse((await readCategory(categoryId)).body);
  const closed = await closeCategory(categoryId, {
    expected_revision: before.revision,
    expected_service_count: before.open_service_count,
  });
  expect(closed.status).toBe(200);
  const middle = serviceCategoryDetail.parse((await readCategory(categoryId)).body);
  const response = await reopenCategory(categoryId, {
    expected_revision: middle.revision,
    expected_service_count: middle.marked_service_count,
  });
  expect(response.status).toBe(200);
  expect(response.body['closed_at']).toBeNull();
  expect(response.body['services_reopened']).toBe(1);
  const after = serviceCategoryDetail.parse((await readCategory(categoryId)).body);
  expect(after.closed_at).toBeNull();
  expect(after.open_service_count).toBe(1);
  expect(after.marked_service_count).toBe(0);
});

it('an unknown category and a category of another business are both not found', async () => {
  await grantCategories(f, f.secondBusiness, 'manage:service-categories:business');
  const foreign = await createCategory(namesFor('Foreign detail category'), f.secondBusiness);
  expect(foreign.status).toBe(201);
  const unknown = await readCategory(ids.newId());
  expect(unknown.status).toBe(404);
  expect(unknown.body['code']).toBe('SERVICE_CATEGORY_NOT_FOUND');
  const otherBusiness = await readCategory(serviceCategory.parse(foreign.body).id);
  expect(otherBusiness.status).toBe(404);
  expect(otherBusiness.body['code']).toBe('SERVICE_CATEGORY_NOT_FOUND');
});

it('a closed service cannot be added to a new session', async () => {
  const serviceId = must(s.services[0]);
  const closed = await closeService(serviceId);
  expect(closed.status).toBe(200);
  const response = await s.h.send('POST', s.base, {
    cookie: s.cookie,
    company: s.company,
    key: sessionIds.newId(),
    body: { customer_id: s.customer, lines: [s.line(serviceId)] },
  });
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('SERVICE_CLOSED');
});

it('a closed service cannot be appended to a saved session', async () => {
  const closedId = must(s.services[1]);
  const closed = await closeService(closedId);
  expect(closed.status).toBe(200);
  const created = await s.h.send('POST', s.base, {
    cookie: s.cookie,
    company: s.company,
    key: sessionIds.newId(),
    body: { customer_id: s.customer, lines: [s.line(must(s.services[3]), '15.000')] },
  });
  expect(created.status).toBe(201);
  const sessionId = recordServiceSessionResponse.parse(created.body).session.id;
  const response = await s.h.send('POST', `${s.base}/${sessionId}/lines`, {
    cookie: s.cookie,
    company: s.company,
    key: sessionIds.newId(),
    body: { lines: [s.line(closedId, '7.125')] },
  });
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('SERVICE_CLOSED');
});

it('the category detail counts use the services category index', async () => {
  const categoryId = await categoryWithService('Indexed detail category');
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${serviceCategoryDetailStatement(f.company, f.business, categoryId)}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('services_business_category_idx');
});
