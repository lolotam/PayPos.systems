import type { EmployeeDetail } from '@pospay/contracts';
import { employeeUserMembership } from './employees.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createForUpdate,
  executeUpdate,
  patchEmployee,
  updateEmployeeFixture,
  employeeGrants,
  ids,
  type UpdateFixture,
} from './update-employee.fixture.ts';
let f: UpdateFixture;
let record: EmployeeDetail;
beforeAll(async () => {
  f = await updateEmployeeFixture();
  record = await createForUpdate(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const reset = () => employeeGrants(f, [['ALLOW', 'BUSINESS', f.business]]);

it('UE-06 denied primary source behaves exactly like a missing employee', async () => {
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.branch],
  ]);
  const denied = await patchEmployee(f, record, {
    name_en: 'Blocked source',
    primary_branch_id: f.sibling,
    branch_ids: [f.sibling],
  });
  const absent = await patchEmployee(f, { ...record, id: ids.newId() });
  expect(denied).toEqual(absent);
  expect(denied).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  await reset();
});
it('denied target cannot be attached or become primary', async () => {
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.sibling],
  ]);
  for (const change of [
    { branch_ids: [f.branch, f.sibling] },
    { primary_branch_id: f.sibling, branch_ids: [f.sibling] },
  ])
    expect(await patchEmployee(f, record, change)).toMatchObject({
      status: 403,
      body: { code: 'FORBIDDEN' },
    });
  await reset();
});
it('non-primary source DENY prevents detaching it or updating any field', async () => {
  record = await executeUpdate(f, record, { branch_ids: [f.branch, f.sibling] });
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BRANCH', f.sibling],
  ]);
  expect(await patchEmployee(f, record, { branch_ids: [f.branch] })).toMatchObject({
    status: 404,
    body: { code: 'NOT_FOUND' },
  });
  expect(await patchEmployee(f, record, { name_en: 'Blocked non-primary source' })).toMatchObject({
    status: 404,
    body: { code: 'NOT_FOUND' },
  });
  const detail = await f.h.send('GET', `/v1/businesses/${f.business}/employees/${record.id}`, {
    cookie: f.cookie,
    company: f.company,
  });
  expect(detail.status).toBe(404);
  await reset();
  record = await executeUpdate(f, record, { branch_ids: [f.branch] });
});
it('branch-only ALLOW permits source edit but requires target ALLOW for a move', async () => {
  await employeeGrants(f, [['ALLOW', 'BRANCH', f.branch]]);
  record = await executeUpdate(f, record, { name_en: 'Allowed branch edit' });
  expect(await patchEmployee(f, record, { branch_ids: [f.branch, f.sibling] })).toMatchObject({
    status: 403,
    body: { code: 'FORBIDDEN' },
  });
  await employeeGrants(f, [
    ['ALLOW', 'BRANCH', f.branch],
    ['ALLOW', 'BRANCH', f.sibling],
  ]);
  expect(
    await executeUpdate(f, record, {
      primary_branch_id: f.sibling,
      branch_ids: [f.branch, f.sibling],
    }),
  ).toMatchObject({ primary_branch_id: f.sibling });
  await reset();
});
it('missing grants, cross-company/business, soft deletion and missing employees share NOT_FOUND', async () => {
  const own = await createForUpdate(f);
  const missing = await patchEmployee(f, { ...own, id: ids.newId() });
  expect(await patchEmployee(f, own, {}, f.business, f.otherCompany)).toEqual(missing);
  expect(await patchEmployee(f, own, {}, f.secondBusiness)).toEqual(missing);
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE id=${own.id}`;
  expect(await patchEmployee(f, own)).toEqual(missing);
  await employeeGrants(f, []);
  expect(await patchEmployee(f, record)).toEqual(missing);
  await reset();
});
it('rechecks staff feature in the transaction and refuses an ended actor membership', async () => {
  const own = await createForUpdate(f);
  const anotherOwner = ids.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${anotherOwner},'Synthetic second owner',${`${anotherOwner}@example.test`})`;
  await employeeUserMembership(f, anotherOwner);
  await f.h
    .owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by) VALUES (${f.company},'staff',false,'Synthetic disabled',${f.userId})`;
  try {
    expect(await patchEmployee(f, own)).toMatchObject({
      status: 403,
      body: { code: 'FEATURE_DISABLED' },
    });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
  await f.h
    .owner`UPDATE memberships SET ends_at=clock_timestamp() WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    await expect(executeUpdate(f, own, { name_en: 'Ended membership' })).rejects.toThrow(
      'NOT_FOUND',
    );
  } finally {
    await f.h
      .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});
it('requires verified principal and rejects scope claims and malformed update contracts', async () => {
  const own = await createForUpdate(f);
  const response = await f.h.app.inject({
    method: 'PATCH',
    url: `/v1/businesses/${f.business}/employees/${own.id}`,
    payload: {},
  });
  expect(response.statusCode).toBe(401);
  for (const change of [
    { company_id: f.company },
    { expected_revision: 0 },
    { role_code: 'device' },
    { branch_effective_date: '2026-02-30' },
    { name_en: '  ' },
    { branch_ids: [f.branch, f.branch] },
  ])
    expect(await patchEmployee(f, own, change)).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION_FAILED' },
    });
});
