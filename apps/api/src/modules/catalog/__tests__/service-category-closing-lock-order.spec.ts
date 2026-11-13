import { randomUUID } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

interface CategoryState {
  readonly revision: number;
  readonly closed_at: Date | string | null;
}

interface ServiceState {
  readonly revision: number;
  readonly closed_at: Date | string | null;
  readonly closed_by_category_id: string | null;
}

const AT = '2026-11-13T09:00:00Z';

let f: ServiceCategoryFixture;
let categoryId = '';
const serviceId = randomUUID();

const createCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const closeCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/close`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const reopenCategory = (body: object) =>
  f.h.send('POST', `/v1/businesses/${f.business}/service-categories/${categoryId}/reopen`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });

async function readCategory(): Promise<CategoryState> {
  const [row] = await f.h.owner<CategoryState[]>`SELECT revision,closed_at FROM service_categories
    WHERE company_id=${f.company} AND business_id=${f.business} AND id=${categoryId}`;
  return { revision: Number(row?.revision), closed_at: row?.closed_at ?? null };
}

async function readService(): Promise<ServiceState> {
  const [row] = await f.h.owner<ServiceState[]>`SELECT revision,closed_at,closed_by_category_id
    FROM services WHERE company_id=${f.company} AND business_id=${f.business} AND id=${serviceId}`;
  return {
    revision: Number(row?.revision),
    closed_at: row?.closed_at ?? null,
    closed_by_category_id: row?.closed_by_category_id ?? null,
  };
}

/** خدمة تتضاف بعد تغيير حالة التصنيف، عشان استعلام القفل الخاص بالحالة المرفوضة يلاقيها فعلاً. */
async function addLateService(closedByCategory: boolean): Promise<string> {
  const id = randomUUID();
  await f.h.owner`INSERT INTO services
    (company_id,id,business_id,name_en,price,commission_rule_kind,category_id,closed_at,
      closed_by_category_id,revision,created_at,updated_at)
    VALUES (${f.company},${id},${f.business},'Late lock order service',3.000,'FOLLOW_PLAN',
      ${categoryId},${closedByCategory ? AT : null},${closedByCategory ? categoryId : null},1,${AT},${AT})`;
  return id;
}

async function whileServiceIsShared(lockedId: string, run: () => Promise<void>): Promise<void> {
  // مجمع المالك في الهارنس اتصال واحد، فالقفل بيتمسك على اتصال مستقل عشان الطلب والفحص يلاقوا اتصال فاضي.
  const holder = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await holder.begin(async (tx) => {
      await tx`SELECT id FROM services WHERE company_id=${f.company} AND id=${lockedId} FOR SHARE`;
      // إثبات تعارض القفل هنا بيضمن إن نجاح الطلب معناه إنه ما حاولش يقفل الخدمة، مش إن القفل مش متعارض.
      await expect(
        f.h.owner`SELECT id FROM services WHERE company_id=${f.company} AND id=${lockedId}
          FOR NO KEY UPDATE NOWAIT`,
      ).rejects.toMatchObject({ code: '55P03' });
      await run();
    });
  } finally {
    await holder.end();
  }
}

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
  const created = await createCategory(namesFor('Lock order category'));
  expect(created.status).toBe(201);
  categoryId = created.body['id'] as string;
  await f.h.owner`INSERT INTO services
    (company_id,id,business_id,name_en,price,commission_rule_kind,category_id,revision,created_at,updated_at)
    VALUES (${f.company},${serviceId},${f.business},'Lock order service',12.500,'FOLLOW_PLAN',
      ${categoryId},1,${AT},${AT})`;
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('C3-01 close rejects a stale revision without waiting for the shared service', async () => {
  const categoryBefore = await readCategory();
  const serviceBefore = await readService();
  await whileServiceIsShared(serviceId, async () => {
    const response = await closeCategory({
      expected_revision: categoryBefore.revision + 1,
      expected_service_count: 1,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'SERVICE_CATEGORY_REVISION_CONFLICT' });
  });
  expect(await readCategory()).toEqual(categoryBefore);
  expect(await readService()).toEqual(serviceBefore);
});

it('C3-02 close rejects an already-closed category without waiting for its service', async () => {
  const closed = await closeCategory({
    expected_revision: (await readCategory()).revision,
    expected_service_count: 1,
  });
  expect(closed.status).toBe(200);
  const lateOpen = await addLateService(false);
  const categoryBefore = await readCategory();
  const serviceBefore = await readService();
  await whileServiceIsShared(lateOpen, async () => {
    const response = await closeCategory({
      expected_revision: categoryBefore.revision,
      expected_service_count: 1,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'SERVICE_CATEGORY_ALREADY_CLOSED' });
  });
  expect(await readCategory()).toEqual(categoryBefore);
  expect(await readService()).toEqual(serviceBefore);
});

it('C3-03 reopen rejects a stale revision without waiting for the marked service', async () => {
  const categoryBefore = await readCategory();
  const serviceBefore = await readService();
  await whileServiceIsShared(serviceId, async () => {
    const response = await reopenCategory({
      expected_revision: categoryBefore.revision + 1,
      expected_service_count: 1,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'SERVICE_CATEGORY_REVISION_CONFLICT' });
  });
  expect(await readCategory()).toEqual(categoryBefore);
  expect(await readService()).toEqual(serviceBefore);
});

it('C3-04 reopen rejects an open category without waiting for its service', async () => {
  const reopened = await reopenCategory({
    expected_revision: (await readCategory()).revision,
    expected_service_count: 1,
  });
  expect(reopened.status).toBe(200);
  const lateMarked = await addLateService(true);
  const categoryBefore = await readCategory();
  const serviceBefore = await readService();
  await whileServiceIsShared(lateMarked, async () => {
    const response = await reopenCategory({
      expected_revision: categoryBefore.revision,
      expected_service_count: 1,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'SERVICE_CATEGORY_NOT_CLOSED' });
  });
  expect(await readCategory()).toEqual(categoryBefore);
  expect(await readService()).toEqual(serviceBefore);
});
