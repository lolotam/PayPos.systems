import { serviceCategory, serviceCategoryDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

const ids = systemUuidV7();

let f: ServiceCategoryFixture;

const createCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
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

/** تصنيف جديد ونسخته الأولى. */
async function categoryWith(
  name: string,
  services: number,
): Promise<{ id: string; revision: number }> {
  const created = await createCategory(namesFor(name));
  expect(created.status).toBe(201);
  const category = serviceCategory.parse(created.body);
  if (services > 0) {
    await f.h.owner`INSERT INTO services
      (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,
        category_id,revision)
      SELECT ${f.company}, gen_random_uuid(), ${f.business}, 'Closing service ' || gs.n,
        12.500, 'FOLLOW_PLAN', true, ${category.id}, 1
      FROM generate_series(1, ${services}::int) AS gs(n)`;
    await f.h.owner`ANALYZE services`;
  }
  return { id: category.id, revision: category.revision };
}

/** صفوف طلبات القفل أو الفتح بتوع التصنيف. */
const closingRows = async (categoryId: string): Promise<Record<string, unknown>[]> =>
  f.h.owner`SELECT id,category_id,action,status,expected_revision,expected_service_count,
    services_changed,error_code,requested_by,requested_at,deadline_at,finished_at
    FROM service_category_closings WHERE company_id=${f.company} AND category_id=${categoryId}
    ORDER BY requested_at,id`;
const closingEvents = async (closingId: string): Promise<Record<string, unknown>[]> =>
  f.h.owner`SELECT aggregate_type,aggregate_id,event_type,payload FROM outbox
    WHERE company_id=${f.company} AND event_type='ServiceCategoryClosingRequested'
      AND aggregate_id=${closingId} ORDER BY id`;
const closingEventCount = async (): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM outbox
    WHERE company_id=${f.company} AND event_type='ServiceCategoryClosingRequested'`;
  return Number(row?.['n'] ?? 0);
};
const closedServiceCount = async (categoryId: string): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM services
    WHERE company_id=${f.company} AND category_id=${categoryId} AND closed_at IS NOT NULL`;
  return Number(row?.['n'] ?? 0);
};
/** عدد صفوف تدقيق التصنيف: إنشاء التصنيف بيسجل صف، فالفرق قبل وبعد هو أثر الطلب نفسه. */
const categoryAuditCount = async (categoryId: string): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
    WHERE company_id=${f.company} AND entity='service_category' AND entity_id=${categoryId}`;
  return Number(row?.['n'] ?? 0);
};
/** عدد صفوف تدقيق خدمات التصنيف: أي تدقيق لخدمة من خدماته. */
const serviceAuditCount = async (categoryId: string): Promise<number> => {
  const [row] = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
    WHERE company_id=${f.company} AND entity='service' AND entity_id IN (
      SELECT id FROM services WHERE company_id=${f.company} AND category_id=${categoryId})`;
  return Number(row?.['n'] ?? 0);
};

/** يزرع طلباً معلّقاً فوق التصنيف بموعد نهائي في الماضي أو في المستقبل. */
async function seedPendingClosing(
  categoryId: string,
  action: 'close' | 'reopen',
  expectedRevision: number,
  expectedServiceCount: number,
  deadlineAt: string,
): Promise<string> {
  const closingId = ids.newId();
  await f.h.owner`INSERT INTO service_category_closings
    (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
      requested_by,requested_at,deadline_at)
    VALUES (${f.company},${closingId},${f.business},${categoryId},${action},'pending',
      ${expectedRevision},${expectedServiceCount},${f.userId},
      ${'2019-12-31T23:00:00.000Z'}::timestamptz,${deadlineAt}::timestamptz)`;
  return closingId;
}

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('closes 300 services synchronously with the unchanged body and no request row', async () => {
  const category = await categoryWith('Sync closing category', 300);
  const eventsBefore = await closingEventCount();
  const response = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 300,
  });
  expect(response.status).toBe(200);
  expect(response.body['services_closed']).toBe(300);
  expect(response.body['closed_at']).toEqual(expect.any(String));
  expect(await closedServiceCount(category.id)).toBe(300);
  expect(await closingRows(category.id)).toHaveLength(0);
  expect(await closingEventCount()).toBe(eventsBefore);
});

it('accepts 301 services in the background and changes nothing but the request row and its event', async () => {
  const category = await categoryWith('Background closing category', 301);
  const categoryAuditsBefore = await categoryAuditCount(category.id);
  const serviceAuditsBefore = await serviceAuditCount(category.id);
  const response = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 301,
  });
  expect(response.status).toBe(202);
  const closingId = response.body['closing_id'] as string;
  expect(response.body['status']).toBe('pending');

  const rows = await closingRows(category.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: closingId,
    category_id: category.id,
    action: 'close',
    status: 'pending',
    expected_revision: category.revision,
    expected_service_count: 301,
    services_changed: null,
    error_code: null,
    requested_by: f.userId,
    finished_at: null,
  });
  expect(new Date(rows[0]?.['requested_at'] as Date).getTime()).toBeLessThan(
    new Date(rows[0]?.['deadline_at'] as Date).getTime(),
  );

  const events = await closingEvents(closingId);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    aggregate_type: 'service_category_closing',
    aggregate_id: closingId,
    event_type: 'ServiceCategoryClosingRequested',
  });
  expect(events[0]?.['payload']).toEqual({ closing_id: closingId });

  expect(await closedServiceCount(category.id)).toBe(0);
  expect(await categoryAuditCount(category.id)).toBe(categoryAuditsBefore);
  expect(await serviceAuditCount(category.id)).toBe(serviceAuditsBefore);
  const detail = await f.h.send(
    'GET',
    `/v1/businesses/${f.business}/service-categories/${category.id}`,
    {
      cookie: f.cookie,
      company: f.company,
    },
  );
  expect(detail.status).toBe(200);
  expect(serviceCategoryDetail.parse(detail.body)).toMatchObject({
    revision: category.revision,
    closed_at: null,
    open_service_count: 301,
    pending_closing_id: closingId,
  });
});

it('answers the same request with the same closing and writes no second row or event', async () => {
  const category = await categoryWith('Replayed closing category', 301);
  const body = { expected_revision: category.revision, expected_service_count: 301 };
  const first = await closeCategory(category.id, body);
  expect(first.status).toBe(202);
  const again = await closeCategory(category.id, body);
  expect(again.status).toBe(202);
  expect(again.body['closing_id']).toBe(first.body['closing_id']);
  expect(await closingRows(category.id)).toHaveLength(1);
  expect(await closingEvents(first.body['closing_id'] as string)).toHaveLength(1);
});

it('refuses a different request while a closing is pending and names the pending closing', async () => {
  const category = await categoryWith('Conflicting closing category', 301);
  const accepted = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 301,
  });
  expect(accepted.status).toBe(202);
  const closingId = accepted.body['closing_id'] as string;

  const otherAction = await reopenCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 0,
  });
  expect(otherAction.status).toBe(409);
  expect(otherAction.body['code']).toBe('SERVICE_CATEGORY_CLOSING_IN_PROGRESS');
  expect(otherAction.body['details']).toEqual({ closing_id: closingId });

  const otherRevision = await closeCategory(category.id, {
    expected_revision: category.revision + 1,
    expected_service_count: 301,
  });
  expect(otherRevision.status).toBe(409);
  expect(otherRevision.body['code']).toBe('SERVICE_CATEGORY_CLOSING_IN_PROGRESS');
  expect(otherRevision.body['details']).toEqual({ closing_id: closingId });
  expect(await closingRows(category.id)).toHaveLength(1);
});

it('refuses a request below the limit while a background closing is pending', async () => {
  const category = await categoryWith('Small request pending category', 301);
  const accepted = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 301,
  });
  expect(accepted.status).toBe(202);
  const refused = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 300,
  });
  expect(refused.status).toBe(409);
  expect(refused.body['code']).toBe('SERVICE_CATEGORY_CLOSING_IN_PROGRESS');
  expect(await closingRows(category.id)).toHaveLength(1);
});

it('ends an expired pending request and lets the new request through', async () => {
  const category = await categoryWith('Expired closing category', 301);
  const expired = await seedPendingClosing(
    category.id,
    'close',
    category.revision,
    301,
    '2020-01-01T00:00:00.000Z',
  );
  const response = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 301,
  });
  expect(response.status).toBe(202);
  expect(response.body['closing_id']).not.toBe(expired);
  const rows = await closingRows(category.id);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    id: expired,
    status: 'failed',
    error_code: 'SERVICE_CATEGORY_CLOSING_EXPIRED',
  });
  expect(rows[0]?.['finished_at']).toEqual(expect.any(Date));
  expect(rows[1]).toMatchObject({ status: 'pending' });
});

it('keeps a count mismatch on the synchronous refusal and writes no request row', async () => {
  const category = await categoryWith('Mismatched count category', 301);
  const eventsBefore = await closingEventCount();
  const response = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 300,
  });
  expect(response.status).toBe(409);
  expect(response.body['code']).toBe('SERVICE_CATEGORY_COUNT_CHANGED');
  expect(await closingRows(category.id)).toHaveLength(0);
  expect(await closingEventCount()).toBe(eventsBefore);
});

it("answers another tenant's category as not found and writes no request row", async () => {
  const foreign = ids.newId();
  await f.h.owner`INSERT INTO service_categories
    (company_id,id,business_id,name_en,name_ar,visibility,revision,created_at,updated_at)
    VALUES (${f.otherCompany},${foreign},${f.foreignBusiness},'Foreign closing category',
      'تصنيف اجنبي','BUSINESS',1,now(),now())`;
  const response = await closeCategory(foreign, {
    expected_revision: 1,
    expected_service_count: 1,
  });
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('SERVICE_CATEGORY_NOT_FOUND');
  const rows = await f.h.owner`SELECT id FROM service_category_closings
    WHERE company_id=${f.company} AND category_id=${foreign}`;
  expect(rows).toHaveLength(0);
});
