import { serviceCategory } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  grantBranchCategories,
  grantCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

let f: ServiceCategoryFixture;
beforeAll(async () => {
  f = await serviceCategoriesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const post = (body: object, business = f.business) =>
  f.h.send('POST', `/v1/businesses/${business}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const patch = (id: string, body: object, business = f.business) =>
  f.h.send('PATCH', `/v1/businesses/${business}/service-categories/${id}`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const branchPost = (body: object, branch = f.branch) =>
  f.h.send('POST', `/v1/businesses/${f.business}/branches/${branch}/service-categories`, {
    cookie: f.cookie,
    company: f.company,
    body,
  });
const branchPatch = (id: string, body: object, branch = f.branch) =>
  f.h.send(
    'PATCH',
    `/v1/businesses/${f.business}/branches/${branch}/service-categories/${id}`,
    { cookie: f.cookie, company: f.company, body },
  );

it('SC-01 needs a session and the permission before anything is written', async () => {
  expect(
    (
      await f.h.app.inject({
        method: 'POST',
        url: `/v1/businesses/${f.business}/service-categories`,
        headers: { 'x-company-id': f.company },
        payload: namesFor('No session'),
      })
    ).statusCode,
  ).toBe(401);
  expect((await post(namesFor('No permission'))).status).toBe(403);
  expect(
    await f.h.owner`SELECT 1 FROM service_categories WHERE name_en='No permission'`,
  ).toHaveLength(0);
  await grantCategories(f);
});

it('SC-02 creates a business category, audits it once and keeps no owner branch', async () => {
  const response = await post(namesFor('Business category'));
  expect(response.status).toBe(201);
  const created = serviceCategory.parse(response.body);
  expect(created).toMatchObject({
    name_en: 'Business category',
    name_ar: 'تصنيف تجريبي',
    visibility: 'BUSINESS',
    owner_branch_id: null,
    closed_at: null,
    revision: 1,
  });
  expect(created.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-7/);
  const audits = await f.h
    .owner`SELECT actor_user_id,action,after FROM audit_log WHERE entity='service_category' AND entity_id=${created.id}`;
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actor_user_id: f.userId, action: 'created' });
  expect(audits[0]?.['after']).toMatchObject({ revision: 1, visibility: 'BUSINESS' });
});

it('SC-03 refuses a name taken in the same business whatever the case or spaces', async () => {
  await post(namesFor('Unique category'));
  for (const name of [' unique category ', 'UNIQUE CATEGORY']) {
    const response = await post(namesFor(name));
    expect(response.status).toBe(409);
    expect(response.body['code']).toBe('SERVICE_CATEGORY_NAME_TAKEN');
  }
  expect(
    await f.h.owner`SELECT 1 FROM service_categories WHERE lower(name_en)='unique category'`,
  ).toHaveLength(1);
});

it('SC-04 renames a category, advances the revision and audits before and after', async () => {
  const created = serviceCategory.parse((await post(namesFor('Renamed category'))).body);
  const body = { ...namesFor('Renamed category v2'), expected_revision: 1 };
  const response = await patch(created.id, body);
  expect(response.status).toBe(200);
  expect(serviceCategory.parse(response.body)).toMatchObject({
    name_en: 'Renamed category v2',
    revision: 2,
    visibility: 'BUSINESS',
  });
  const audits = await f.h
    .owner`SELECT before,after FROM audit_log WHERE entity='service_category' AND entity_id=${created.id} AND action='updated'`;
  expect(audits).toHaveLength(1);
  expect(audits[0]?.['before']).toMatchObject({ name_en: 'Renamed category', revision: 1 });
  expect(audits[0]?.['after']).toMatchObject({ name_en: 'Renamed category v2', revision: 2 });
});

it('SC-05 refuses a stale revision and writes nothing', async () => {
  const created = serviceCategory.parse((await post(namesFor('Stale revision'))).body);
  const body = { ...namesFor('Stale revision v2'), expected_revision: 1 };
  expect((await patch(created.id, body)).status).toBe(200);
  const stale = await patch(created.id, { ...namesFor('Stale revision v3'), expected_revision: 1 });
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({ code: 'SERVICE_CATEGORY_REVISION_CONFLICT' });
  expect(
    await f.h.owner`SELECT name_en FROM service_categories WHERE id=${created.id}`,
  ).toEqual([{ name_en: 'Stale revision v2' }]);
});

it('SC-06 shares a private category and never makes a shared one private again', async () => {
  await grantBranchCategories(f, f.branch);
  const private_ = serviceCategory.parse(
    (await branchPost({ ...namesFor('Shareable category'), visibility: 'BRANCH' })).body,
  );
  expect(private_).toMatchObject({ visibility: 'BRANCH', owner_branch_id: f.branch, revision: 1 });
  const shared = await patch(private_.id, {
    ...namesFor('Shareable category'),
    visibility: 'BUSINESS',
    expected_revision: 1,
  });
  expect(shared.status).toBe(200);
  expect(serviceCategory.parse(shared.body)).toMatchObject({
    visibility: 'BUSINESS',
    owner_branch_id: f.branch,
    revision: 2,
  });
  const back = await patch(private_.id, {
    ...namesFor('Shareable category'),
    visibility: 'BRANCH',
    expected_revision: 2,
  });
  expect(back.status).toBe(409);
  expect(back.body).toMatchObject({ code: 'SERVICE_CATEGORY_VISIBILITY_FIXED' });
  const stale = await patch(private_.id, {
    ...namesFor('Shareable category v2'),
    expected_revision: 1,
  });
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({ code: 'SERVICE_CATEGORY_REVISION_CONFLICT' });
  expect(
    await f.h.owner`SELECT visibility FROM service_categories WHERE id=${private_.id}`,
  ).toEqual([{ visibility: 'BUSINESS' }]);
});

it('SC-07 a branch creates a category that records it as the owner', async () => {
  const response = await branchPost({ ...namesFor('Branch category'), visibility: 'BRANCH' });
  expect(response.status).toBe(201);
  expect(serviceCategory.parse(response.body)).toMatchObject({
    visibility: 'BRANCH',
    owner_branch_id: f.branch,
    revision: 1,
  });
  const shared = await branchPost({ ...namesFor('Branch shared category'), visibility: 'BUSINESS' });
  expect(shared.status).toBe(201);
  expect(serviceCategory.parse(shared.body)).toMatchObject({
    visibility: 'BUSINESS',
    owner_branch_id: f.branch,
  });
});

it('SC-08 a branch renames its own private category and refuses a shared one', async () => {
  const own = serviceCategory.parse(
    (await branchPost({ ...namesFor('Branch own category'), visibility: 'BRANCH' })).body,
  );
  const renamed = await branchPatch(own.id, {
    ...namesFor('Branch own category v2'),
    expected_revision: 1,
  });
  expect(renamed.status).toBe(200);
  expect(serviceCategory.parse(renamed.body)).toMatchObject({
    name_en: 'Branch own category v2',
    revision: 2,
  });
  const shared = serviceCategory.parse(
    (await branchPost({ ...namesFor('Branch shared target'), visibility: 'BUSINESS' })).body,
  );
  const refused = await branchPatch(shared.id, {
    ...namesFor('Branch shared target v2'),
    expected_revision: 1,
  });
  expect(refused.status).toBe(409);
  expect(refused.body).toMatchObject({ code: 'SERVICE_CATEGORY_VISIBILITY_FIXED' });
  expect(
    await f.h.owner`SELECT name_en FROM service_categories WHERE id=${shared.id}`,
  ).toEqual([{ name_en: 'Branch shared target' }]);
});

it('SC-09 a branch does not rename a private category of another branch', async () => {
  await grantBranchCategories(f, f.otherBranch);
  const other = serviceCategory.parse(
    (
      await branchPost(
        { ...namesFor('Other branch category'), visibility: 'BRANCH' },
        f.otherBranch,
      )
    ).body,
  );
  const refused = await branchPatch(other.id, {
    ...namesFor('Other branch category v2'),
    expected_revision: 1,
  });
  expect(refused.status).toBe(404);
  expect(refused.body).toMatchObject({ code: 'SERVICE_CATEGORY_NOT_FOUND' });
});

it('SC-10 a category of another business or another tenant is not found', async () => {
  const created = serviceCategory.parse((await post(namesFor('Isolation category'))).body);
  const input = { ...namesFor('Isolation category v2'), expected_revision: 1 };
  await expect(
    f.rename.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.secondBusiness,
      categoryId: created.id,
      input,
    }),
  ).rejects.toThrow('SERVICE_CATEGORY_NOT_FOUND');
  await expect(
    f.rename.execute({
      companyId: f.otherCompany,
      userId: f.userId,
      businessId: f.foreignBusiness,
      categoryId: created.id,
      input,
    }),
  ).rejects.toThrow('SERVICE_CATEGORY_NOT_FOUND');
  expect(
    await f.h.owner`SELECT name_en FROM service_categories WHERE id=${created.id}`,
  ).toEqual([{ name_en: 'Isolation category' }]);
});

it('SC-11 the branch route reads the branch business from the database, not the client', async () => {
  await grantBranchCategories(f, f.otherBranch);
  const mismatch = await f.h.send(
    'POST',
    `/v1/businesses/${f.secondBusiness}/branches/${f.branch}/service-categories`,
    {
      cookie: f.cookie,
      company: f.company,
      body: { ...namesFor('Mismatched business'), visibility: 'BRANCH' },
    },
  );
  expect(mismatch.status).toBe(404);
  expect(mismatch.body['code']).toBe('SERVICE_CATEGORY_NOT_FOUND');
  expect(
    await f.h.owner`SELECT 1 FROM service_categories WHERE name_en='Mismatched business'`,
  ).toHaveLength(0);
  const other = await branchPost(
    { ...namesFor('Other branch owned category'), visibility: 'BRANCH' },
    f.otherBranch,
  );
  expect(other.status).toBe(201);
  expect(serviceCategory.parse(other.body)).toMatchObject({
    owner_branch_id: f.otherBranch,
    visibility: 'BRANCH',
  });
});
