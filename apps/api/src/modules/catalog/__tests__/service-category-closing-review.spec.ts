import { serviceCategory, serviceCategoryClosingStatus } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

const ids = systemUuidV7();
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';
const LONG_AGO = '2020-01-01T00:00:00.000Z';
const REQUEST_DEADLINE_MS = 3000;

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
const readClosing = (categoryId: string, closingId: string, businessId = f.business) =>
  f.h.send(
    'GET',
    `/v1/businesses/${businessId}/service-categories/${categoryId}/closings/${closingId}`,
    { cookie: f.cookie, company: f.company },
  );

async function categoryWith(name: string, services: number) {
  const created = await createCategory(namesFor(name));
  expect(created.status).toBe(201);
  const category = serviceCategory.parse(created.body);
  if (services > 0) {
    await f.h.owner`INSERT INTO services
      (company_id,id,business_id,name_en,price,commission_rule_kind,counts_toward_threshold,
        category_id,revision)
      SELECT ${f.company}, gen_random_uuid(), ${f.business}, 'Review service ' || gs.n,
        12.500, 'FOLLOW_PLAN', true, ${category.id}, 1
      FROM generate_series(1, ${services}::int) AS gs(n)`;
    await f.h.owner`ANALYZE services`;
  }
  return category;
}

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

async function withinDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('CATEGORY_LOCK_PRECHECK_TIMEOUT')),
      REQUEST_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function expectExpiredRow(closingId: string): Promise<void> {
  const [row] = await f.h.owner`SELECT status,error_code,finished_at
    FROM service_category_closings WHERE company_id=${f.company} AND id=${closingId}`;
  expect(row).toMatchObject({
    status: 'failed',
    error_code: 'SERVICE_CATEGORY_CLOSING_EXPIRED',
    finished_at: expect.any(Date),
  });
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

it('reads uppercase business, category and closing UUIDs and rejects a wrong uppercase category', async () => {
  const category = await categoryWith('Uppercase closing status category', 0);
  const other = await categoryWith('Wrong uppercase closing status category', 0);
  const closingId = await seedPendingClosing(
    category.id,
    'close',
    category.revision,
    301,
    FAR_FUTURE,
  );
  const lower = await readClosing(category.id, closingId);
  expect(lower.status).toBe(200);
  serviceCategoryClosingStatus.parse(lower.body);

  const upper = await readClosing(
    category.id.toUpperCase(),
    closingId.toUpperCase(),
    f.business.toUpperCase(),
  );
  expect(upper.status).toBe(200);
  expect(upper.body).toEqual(lower.body);

  const wrong = await readClosing(
    other.id.toUpperCase(),
    closingId.toUpperCase(),
    f.business.toUpperCase(),
  );
  expect(wrong.status).toBe(404);
  expect(wrong.body).toMatchObject({ code: 'SERVICE_CATEGORY_CLOSING_NOT_FOUND' });
});

it('replays or refuses a pending request without waiting for the category lock', async () => {
  const category = await categoryWith('Pending precheck lock category', 301);
  const input = { expected_revision: category.revision, expected_service_count: 301 };
  const accepted = await closeCategory(category.id, input);
  expect(accepted.status).toBe(202);
  const closingId = accepted.body['closing_id'] as string;
  const holder = postgres(f.h.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await holder.begin(async (tx) => {
      await tx`SELECT id FROM service_categories
        WHERE company_id=${f.company} AND id=${category.id} FOR UPDATE`;
      await expect(
        f.h
          .owner`SELECT id FROM service_categories WHERE company_id=${f.company} AND id=${category.id}
          FOR NO KEY UPDATE NOWAIT`,
      ).rejects.toMatchObject({ code: '55P03' });
      const [replayed, conflict] = await withinDeadline(
        Promise.all([
          closeCategory(category.id, input),
          reopenCategory(category.id, {
            expected_revision: category.revision,
            expected_service_count: 0,
          }),
        ]),
      );
      expect(replayed.status).toBe(202);
      expect(replayed.body).toMatchObject({ closing_id: closingId, status: 'pending' });
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        code: 'SERVICE_CATEGORY_CLOSING_IN_PROGRESS',
        details: { closing_id: closingId },
      });
    });
  } finally {
    await holder.end();
  }
});

it('commits an expired close request before returning a count refusal', async () => {
  const category = await categoryWith('Expired close refusal category', 301);
  const closingId = await seedPendingClosing(
    category.id,
    'close',
    category.revision,
    301,
    LONG_AGO,
  );
  const response = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 300,
  });
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ code: 'SERVICE_CATEGORY_COUNT_CHANGED' });
  await expectExpiredRow(closingId);
});

it('commits an expired reopen request before returning a count refusal', async () => {
  const category = await categoryWith('Expired reopen refusal category', 300);
  const closed = await closeCategory(category.id, {
    expected_revision: category.revision,
    expected_service_count: 300,
  });
  expect(closed.status).toBe(200);
  const revision = closed.body['revision'] as number;
  const closingId = await seedPendingClosing(category.id, 'reopen', revision, 300, LONG_AGO);
  const response = await reopenCategory(category.id, {
    expected_revision: revision,
    expected_service_count: 299,
  });
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ code: 'SERVICE_CATEGORY_COUNT_CHANGED' });
  await expectExpiredRow(closingId);
});
