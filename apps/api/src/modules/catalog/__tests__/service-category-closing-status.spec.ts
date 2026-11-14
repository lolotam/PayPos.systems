import { sql } from 'drizzle-orm';
import { serviceCategoryClosingStatus, serviceCategoryDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { serviceCategoryClosingStatusStatement } from '../queries/service-category-closing.query.ts';
import {
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

const ids = systemUuidV7();

let f: ServiceCategoryFixture;
let categoryCounter = 0;
let roleCounter = 0;

/**
 * كود دور فريد لكل استدعاء، من حروف صغيرة وشرطة سفلية بس.
 * قاعدة `roles_code_format` (`^[a-z][a-z_]{0,63}$`) بترفض الأرقام والشرطات،
 * والكود فريد داخل الشركة، فبنولّده من عدّاد بدل UUID.
 */
const uniqueRoleCode = (): string => {
  roleCounter += 1;
  let remaining = roleCounter;
  let letters = '';
  while (remaining > 0) {
    letters = String.fromCharCode(97 + ((remaining - 1) % 26)) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return `synthetic_closing_${letters}`;
};

const createCategory = (body: object, business = f.business) =>
  f.h.send('POST', `/v1/businesses/${business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const readClosing = (categoryId: string, closingId: string, cookie = f.cookie) =>
  f.h.send(
    'GET',
    `/v1/businesses/${f.business}/service-categories/${categoryId}/closings/${closingId}`,
    {
      cookie,
      company: f.company,
    },
  );
const readCategory = (categoryId: string) =>
  f.h.send('GET', `/v1/businesses/${f.business}/service-categories/${categoryId}`, {
    cookie: f.cookie,
    company: f.company,
  });

/** عضو جديد بصلاحيات محددة فقط، عشان فحوص المسار تشوف أثر كل صلاحية لوحدها. */
async function memberWith(permissions: readonly string[]): Promise<string> {
  const email = `category-closing-${ids.newId()}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [holder] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  const memberId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},${uniqueRoleCode()},'Synthetic closing reader')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${memberId},${holder?.['id'] as string},${role},${f.company},'COMPANY',${f.company})`;
  for (const permission of permissions) {
    await f.h
      .owner`INSERT INTO permission_overrides (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES (${f.company},${ids.newId()},${memberId},${permission},'ALLOW','BUSINESS',${f.business},'Synthetic grant',${f.userId})`;
  }
  return cookie;
}

/** تصنيف جديد في نشاط الشركة، واسمه مختلف كل مرة: الاسم فريد في النشاط. */
async function category(): Promise<string> {
  categoryCounter += 1;
  const created = await createCategory(namesFor(`Closing status category ${categoryCounter}`));
  expect(created.status).toBe(201);
  return created.body['id'] as string;
}

/**
 * يزرع طلب قفل معلّق. الحارس بيقبل الإنشاء معلّقاً بس، فالحالات النهائية بتتعمل بتحديث.
 */
async function seedClosing(
  categoryId: string,
  deadlineAt: string,
  company = f.company,
  business = f.business,
): Promise<string> {
  const closingId = ids.newId();
  await f.h.owner`INSERT INTO service_category_closings
    (company_id,id,business_id,category_id,action,status,expected_revision,expected_service_count,
      requested_by,requested_at,deadline_at)
    VALUES (${company},${closingId},${business},${categoryId},'close','pending',1,301,${f.userId},
      ${'2019-12-31T23:00:00.000Z'}::timestamptz,${deadlineAt}::timestamptz)`;
  return closingId;
}

const FAR_FUTURE = '2099-01-01T00:00:00.000Z';
const LONG_AGO = '2020-01-01T00:00:00.000Z';

beforeAll(async () => {
  f = await serviceCategoriesFixture();
  await grantCategories(f, f.business, 'manage:service-categories:business');
  await grantCategories(f, f.business, 'read:service-categories:business');
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('reads a pending request with its identity and no result yet', async () => {
  const categoryId = await category();
  const closingId = await seedClosing(categoryId, FAR_FUTURE);
  const response = await readClosing(categoryId, closingId);
  expect(response.status).toBe(200);
  expect(serviceCategoryClosingStatus.parse(response.body)).toEqual({
    closing_id: closingId,
    category_id: categoryId,
    action: 'close',
    status: 'pending',
    services_changed: null,
    error_code: null,
    requested_at: '2019-12-31T23:00:00.000Z',
    finished_at: null,
  });
});

it('reads a completed request with the number of services it changed', async () => {
  const categoryId = await category();
  const closingId = await seedClosing(categoryId, FAR_FUTURE);
  await f.h.owner`UPDATE service_category_closings SET status='completed',services_changed=301,
    finished_at=${'2026-01-01T09:00:05.000Z'}::timestamptz WHERE id=${closingId}`;
  const response = await readClosing(categoryId, closingId);
  expect(response.status).toBe(200);
  expect(serviceCategoryClosingStatus.parse(response.body)).toMatchObject({
    status: 'completed',
    services_changed: 301,
    error_code: null,
    finished_at: '2026-01-01T09:00:05.000Z',
  });
});

it('reads a failed request with its failure code', async () => {
  const categoryId = await category();
  const closingId = await seedClosing(categoryId, FAR_FUTURE);
  await f.h.owner`UPDATE service_category_closings SET status='failed',
    error_code='SERVICE_CATEGORY_COUNT_CHANGED',
    finished_at=${'2026-01-01T09:00:05.000Z'}::timestamptz WHERE id=${closingId}`;
  const response = await readClosing(categoryId, closingId);
  expect(response.status).toBe(200);
  expect(serviceCategoryClosingStatus.parse(response.body)).toMatchObject({
    status: 'failed',
    services_changed: null,
    error_code: 'SERVICE_CATEGORY_COUNT_CHANGED',
  });
});

it('reads a pending request past its deadline as failed with the expiry code', async () => {
  const categoryId = await category();
  const closingId = await seedClosing(categoryId, LONG_AGO);
  const response = await readClosing(categoryId, closingId);
  expect(response.status).toBe(200);
  expect(serviceCategoryClosingStatus.parse(response.body)).toMatchObject({
    status: 'failed',
    error_code: 'SERVICE_CATEGORY_CLOSING_EXPIRED',
    services_changed: null,
  });
});

it("answers an unknown id, another category's id and another tenant's id as not found", async () => {
  const categoryId = await category();
  const otherCategoryId = await category();
  const closingId = await seedClosing(categoryId, FAR_FUTURE);
  const unknown = await readClosing(categoryId, ids.newId());
  expect(unknown.status).toBe(404);
  expect(unknown.body['code']).toBe('SERVICE_CATEGORY_CLOSING_NOT_FOUND');
  const otherCategory = await readClosing(otherCategoryId, closingId);
  expect(otherCategory.status).toBe(404);
  expect(otherCategory.body['code']).toBe('SERVICE_CATEGORY_CLOSING_NOT_FOUND');

  const foreignCategory = ids.newId();
  await f.h.owner`INSERT INTO service_categories
    (company_id,id,business_id,name_en,name_ar,visibility,revision,created_at,updated_at)
    VALUES (${f.otherCompany},${foreignCategory},${f.foreignBusiness},'Foreign closing status category',
      'تصنيف اجنبي','BUSINESS',1,now(),now())`;
  const foreignClosing = await seedClosing(
    foreignCategory,
    FAR_FUTURE,
    f.otherCompany,
    f.foreignBusiness,
  );
  const otherTenant = await readClosing(categoryId, foreignClosing);
  expect(otherTenant.status).toBe(404);
  expect(otherTenant.body['code']).toBe('SERVICE_CATEGORY_CLOSING_NOT_FOUND');
});

it('reads the request on the primary key of the closing rows', async () => {
  const categoryId = await category();
  const closingId = await seedClosing(categoryId, FAR_FUTURE);
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${serviceCategoryClosingStatusStatement(
        f.company,
        closingId,
      )}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('service_category_closings_pkey');
});

it('refuses a caller without the manage permission and a caller without the read permission', async () => {
  const categoryId = await category();
  const closingId = await seedClosing(categoryId, FAR_FUTURE);
  const reader = await memberWith(['read:service-categories:business']);
  const manager = await memberWith(['manage:service-categories:business']);
  const refusedRead = await readClosing(categoryId, closingId, reader);
  expect(refusedRead.status).toBe(403);
  expect(refusedRead.body['code']).toBe('FORBIDDEN');
  const refusedManage = await readClosing(categoryId, closingId, manager);
  expect(refusedManage.status).toBe(403);
  expect(refusedManage.body['code']).toBe('FORBIDDEN');
});

it('shows the pending request on the category detail and drops it once it is gone', async () => {
  const categoryId = await category();
  const closingId = await seedClosing(categoryId, FAR_FUTURE);
  const withPending = await readCategory(categoryId);
  expect(withPending.status).toBe(200);
  expect(serviceCategoryDetail.parse(withPending.body)).toMatchObject({
    pending_closing_id: closingId,
  });
  await f.h.owner`UPDATE service_category_closings SET status='completed',services_changed=301,
    finished_at=now() WHERE id=${closingId}`;
  const withoutPending = await readCategory(categoryId);
  expect(serviceCategoryDetail.parse(withoutPending.body)).toMatchObject({
    pending_closing_id: null,
  });
});
