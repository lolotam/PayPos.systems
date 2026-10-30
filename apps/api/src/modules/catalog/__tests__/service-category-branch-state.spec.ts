import { randomUUID } from 'node:crypto';

import { serviceCategoryBranchStateResult } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  branchOnlyMember,
  grantBranchCategories,
  namesFor,
  serviceCategoriesFixture,
  type ServiceCategoryFixture,
} from './service-categories.fixture.ts';

let f: ServiceCategoryFixture;
beforeAll(async () => {
  f = await serviceCategoriesFixture();
  for (const branch of [f.branch, f.otherBranch])
    for (const permission of ['manage:service-categories:branch', 'read:service-categories:branch'] as const)
      await grantBranchCategories(f, branch, permission);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const shared = (name: string, business = f.business) =>
  f.create.execute({ companyId: f.company, userId: f.userId, businessId: business, input: namesFor(name) });
const privateCategory = (name: string, branch: string) =>
  f.create.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    branchId: branch,
    input: { ...namesFor(name), visibility: 'BRANCH' },
  });
const path = (branch: string, suffix = '', business = f.business) =>
  `/v1/businesses/${business}/branches/${branch}/service-categories${suffix}`;
const put = (category: string, branch: string, body: object, cookie = f.cookie, business = f.business) =>
  f.h.send('PUT', path(branch, `/${category}/state`, business), { cookie, company: f.company, body });
const view = (branch: string, kind: 'in_use' | 'available', cookie = f.cookie, business = f.business) =>
  f.h.send('GET', `${path(branch, '', business)}?view=${kind}`, { cookie, company: f.company });
const ids = (body: Record<string, unknown>) =>
  (body['items'] as { id: string }[]).map((item) => item.id);
const stored = (category: string, branch: string) =>
  f.h.owner`SELECT state,revision FROM service_category_branch_settings
    WHERE company_id=${f.company} AND branch_id=${branch} AND category_id=${category}`;
const success = (response: { status: number; body: Record<string, unknown> }) => {
  expect(response.status).toBe(200);
  return serviceCategoryBranchStateResult.parse(response.body);
};

it('BCS-01 branch B enables branch A private category without changing A', async () => {
  const category = await privateCategory('BCS01 private', f.branch);
  expect(success(await put(category.id, f.otherBranch, { state: 'ENABLED', expected_revision: null }))).toMatchObject({
    id: category.id, setting_state: 'ENABLED', setting_revision: 1,
  });
  expect(await stored(category.id, f.otherBranch)).toEqual([{ state: 'ENABLED', revision: 1 }]);
  const inUse = await view(f.otherBranch, 'in_use');
  expect(inUse.status).toBe(200);
  expect(ids(inUse.body)).toContain(category.id);
  expect(ids((await view(f.otherBranch, 'available')).body)).not.toContain(category.id);
  expect(ids((await view(f.branch, 'in_use')).body)).toContain(category.id);
  expect(await stored(category.id, f.branch)).toEqual([]);
});

it('BCS-02 hiding a shared category changes only that branch', async () => {
  const category = await shared('BCS02 shared');
  expect(success(await put(category.id, f.branch, { state: 'HIDDEN', expected_revision: null }))).toMatchObject({
    setting_state: 'HIDDEN', setting_revision: 1,
  });
  expect(await stored(category.id, f.branch)).toEqual([{ state: 'HIDDEN', revision: 1 }]);
  expect(ids((await view(f.branch, 'in_use')).body)).not.toContain(category.id);
  expect(ids((await view(f.branch, 'available')).body)).toContain(category.id);
  expect(ids((await view(f.otherBranch, 'in_use')).body)).toContain(category.id);
});

it('BCS-03 hiding an own private category preserves another branch enablement', async () => {
  const category = await privateCategory('BCS03 private', f.branch);
  expect((await put(category.id, f.otherBranch, { state: 'ENABLED', expected_revision: null })).status).toBe(200);
  expect(success(await put(category.id, f.branch, { state: 'HIDDEN', expected_revision: null }))).toMatchObject({
    owner_branch_id: f.branch, setting_state: 'HIDDEN', setting_revision: 1,
  });
  expect(await stored(category.id, f.branch)).toEqual([{ state: 'HIDDEN', revision: 1 }]);
  expect(ids((await view(f.branch, 'in_use')).body)).not.toContain(category.id);
  expect(ids((await view(f.otherBranch, 'in_use')).body)).toContain(category.id);
  expect(await stored(category.id, f.otherBranch)).toEqual([{ state: 'ENABLED', revision: 1 }]);
});

it('BCS-04 stale, non-null first and null later expectations are refused without row changes', async () => {
  const category = await shared('BCS04 revisions');
  for (const body of [{ state: 'ENABLED', expected_revision: 1 }, { state: 'HIDDEN', expected_revision: 7 }]) {
    const refused = await put(category.id, f.branch, body);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'SERVICE_CATEGORY_REVISION_CONFLICT' });
    expect(await stored(category.id, f.branch)).toEqual([]);
  }
  expect(success(await put(category.id, f.branch, { state: 'ENABLED', expected_revision: null })).setting_revision).toBe(1);
  for (const expected_revision of [7, null]) {
    const refused = await put(category.id, f.branch, { state: 'HIDDEN', expected_revision });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'SERVICE_CATEGORY_REVISION_CONFLICT' });
    expect(await stored(category.id, f.branch)).toEqual([{ state: 'ENABLED', revision: 1 }]);
  }
});

it('a concurrent first write loses on the unique key with the same stale 409 and one stored row', async () => {
  const category = await shared('Concurrent first write');
  const responses = await Promise.all([
    put(category.id, f.branch, { state: 'ENABLED', expected_revision: null }),
    put(category.id, f.branch, { state: 'HIDDEN', expected_revision: null }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
    code: 'SERVICE_CATEGORY_REVISION_CONFLICT',
  });
  expect(await stored(category.id, f.branch)).toHaveLength(1);
});

it('enabling a closed category is refused with 409 and no settings row', async () => {
  const category = await shared('Closed category');
  await f.h.owner`UPDATE service_categories SET closed_at=now() WHERE id=${category.id}`;
  const response = await put(category.id, f.branch, { state: 'ENABLED', expected_revision: null });
  expect(response.status).toBe(409);
  expect(response.body).toMatchObject({ code: 'SERVICE_CATEGORY_CLOSED' });
  expect(await stored(category.id, f.branch)).toEqual([]);
});

it('BCS-05 a manager of another branch gets 403 on read and write and stores nothing', async () => {
  const category = await shared('BCS05 forbidden');
  const member = await branchOnlyMember(f, f.branch, [
    'read:service-categories:branch', 'manage:service-categories:branch',
  ]);
  const read = await view(f.otherBranch, 'in_use', member.cookie);
  const write = await put(category.id, f.otherBranch, { state: 'ENABLED', expected_revision: null }, member.cookie);
  expect([read.status, write.status]).toEqual([403, 403]);
  expect([read.body['code'], write.body['code']]).toEqual(['FORBIDDEN', 'FORBIDDEN']);
  expect(await stored(category.id, f.otherBranch)).toEqual([]);
});

it('BCS-06 hiding a category leaves its branch session service options unchanged', async () => {
  const category = await shared('BCS06 grouping only');
  const service = randomUUID();
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${f.company},${service},${f.business},'BCS06 service','5.000','FOLLOW_PLAN')`;
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES (${f.company},${randomUUID()},${f.memberId},'record:service-sessions:branch','ALLOW','BRANCH',${f.otherBranch},'BCS06',${f.userId})`;
  expect((await put(category.id, f.otherBranch, { state: 'HIDDEN', expected_revision: null })).status).toBe(200);
  const options = await f.h.send('GET', `/v1/businesses/${f.business}/branches/${f.otherBranch}/service-sessions/service-options?lang=en`, {
    cookie: f.cookie, company: f.company,
  });
  expect(options.status).toBe(200);
  expect(ids(options.body)).toContain(service);
  expect(await stored(category.id, f.otherBranch)).toEqual([{ state: 'HIDDEN', revision: 1 }]);
  expect(await f.h.owner`SELECT revision FROM services WHERE id=${service}`).toEqual([{ revision: 1 }]);
});

it('BCS-07 a foreign-business category or route branch returns 404 and stores nothing', async () => {
  const local = await shared('BCS07 local');
  const mismatch = await put(local.id, f.branch, { state: 'ENABLED', expected_revision: null }, f.cookie, f.secondBusiness);
  expect(mismatch.status).toBe(404);
  expect(mismatch.body).toMatchObject({ code: 'SERVICE_CATEGORY_NOT_FOUND' });
  const foreign = await shared('BCS07 foreign', f.secondBusiness);
  const otherCategory = await put(foreign.id, f.branch, { state: 'ENABLED', expected_revision: null });
  expect(otherCategory.status).toBe(404);
  const secondBranch = randomUUID();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES (${f.company},${secondBranch},${f.secondBusiness},'BCS07 branch')`;
  await grantBranchCategories(f, secondBranch);
  const otherBranch = await put(local.id, secondBranch, { state: 'ENABLED', expected_revision: null }, f.cookie, f.secondBusiness);
  expect(otherBranch.status).toBe(404);
  expect(otherBranch.body).toMatchObject({ code: 'SERVICE_CATEGORY_NOT_FOUND' });
  expect(await stored(local.id, f.branch)).toEqual([]);
  expect(await stored(foreign.id, f.branch)).toEqual([]);
  expect(await stored(local.id, secondBranch)).toEqual([]);
});

it('BCS-08 a state change writes before and after audit snapshots in the same stored history', async () => {
  const category = await shared('BCS08 audit');
  const enabled = success(await put(category.id, f.branch, { state: 'ENABLED', expected_revision: null }));
  const hidden = success(await put(category.id, f.branch, { state: 'HIDDEN', expected_revision: 1 }));
  expect([enabled.setting_revision, hidden.setting_revision]).toEqual([1, 2]);
  expect(await stored(category.id, f.branch)).toEqual([{ state: 'HIDDEN', revision: 2 }]);
  const audits = await f.h.owner`SELECT action,before,after FROM audit_log
    WHERE entity='service_category_branch_setting' AND entity_id=(
      SELECT id FROM service_category_branch_settings
      WHERE company_id=${f.company} AND branch_id=${f.branch} AND category_id=${category.id})
    ORDER BY at,id`;
  expect(audits).toHaveLength(2);
  expect(audits[1]).toMatchObject({ action: 'updated' });
  expect(audits[1]?.['before']).toMatchObject({ state: 'ENABLED', revision: 1 });
  expect(audits[1]?.['after']).toMatchObject({ state: 'HIDDEN', revision: 2 });
});

it.each(['not-a-cursor', JSON.stringify(['\u0000', '01920000-0000-7000-8000-000000000001'])])('an invalid cursor %j returns 400 VALIDATION_FAILED', async (cursor) => {
  const response = await f.h.send('GET', `${path(f.branch)}?view=in_use&cursor=${encodeURIComponent(cursor)}`, {
    cookie: f.cookie, company: f.company,
  });
  expect(response.status).toBe(400);
  expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
});
