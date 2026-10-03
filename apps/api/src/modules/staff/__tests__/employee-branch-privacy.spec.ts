import type { EmployeeDetail } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { termsFor } from './employees.fixture.ts';
import {
  employeeGrants,
  ids,
  patchEmployee,
  updateEmployeeFixture,
  type UpdateFixture,
} from './update-employee.fixture.ts';
import { createEmployeeDetailAccess } from '../persistence/employee-detail-access.adapter.ts';

let f: UpdateFixture;
let record: EmployeeDetail;
beforeAll(async () => {
  f = await updateEmployeeFixture();
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BUSINESS', f.secondBusiness],
  ]);
  const response = await create();
  expect(response.status).toBe(201);
  record = { ...(response.body as unknown as EmployeeDetail), revision: 1, branch_ids: [f.branch] };
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function create(change: object = {}) {
  const response = await f.h.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.business}/employees`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: { ...termsFor(f), ...change },
  });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

async function counts() {
  return f.h.owner`SELECT
    (SELECT count(*) FROM employees) AS employees,
    (SELECT count(*) FROM employee_branches) AS attachments,
    (SELECT count(*) FROM audit_log WHERE entity='employee') AS audits`;
}

it('create hides denied other-business and other-company primary branches exactly like missing branches', async () => {
  const before = await counts();
  const missing = await create({ primary_branch_id: ids.newId() });
  expect(missing).toMatchObject({ status: 404, body: { code: 'EMPLOYEE_BRANCH_NOT_FOUND' } });
  for (const branch of [f.otherBranch, f.foreignBranch])
    expect(await create({ primary_branch_id: branch })).toEqual(missing);
  expect(await counts()).toEqual(before);
});

it('update hides invalid primary or additional branches exactly like missing branches', async () => {
  const before = await counts();
  const missing = await patchEmployee(f, record, { branch_ids: [f.branch, ids.newId()] });
  expect(missing).toMatchObject({ status: 404, body: { code: 'EMPLOYEE_BRANCH_NOT_FOUND' } });
  for (const branch of [f.otherBranch, f.foreignBranch, ids.newId()]) {
    expect(await patchEmployee(f, record, { branch_ids: [f.branch, branch] })).toEqual(missing);
    expect(
      await patchEmployee(f, record, { primary_branch_id: branch, branch_ids: [branch] }),
    ).toEqual(missing);
    expect(await patchEmployee(f, record, { primary_branch_id: branch })).toEqual(missing);
  }
  expect(await counts()).toEqual(before);
});

it('branch privacy precedes revision, primary-set, contract, user-link, target DENY and feature diagnostics', async () => {
  await employeeGrants(f, [
    ['ALLOW', 'BUSINESS', f.business],
    ['DENY', 'BUSINESS', f.secondBusiness],
    ['DENY', 'BRANCH', f.sibling],
  ]);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES (${f.company},'staff',false,'Synthetic disabled',${f.userId})`;
  try {
    const terms = { contract_end: '2025-01-01', user_id: ids.newId() };
    const missing = await create({ ...terms, primary_branch_id: ids.newId() });
    expect(missing).toMatchObject({ status: 404, body: { code: 'EMPLOYEE_BRANCH_NOT_FOUND' } });
    for (const branch of [f.otherBranch, f.foreignBranch, ids.newId()]) {
      expect(await create({ ...terms, primary_branch_id: branch })).toEqual(missing);
      expect(
        await patchEmployee(f, record, {
          ...terms,
          primary_branch_id: branch,
          branch_ids: [f.branch, f.sibling],
          expected_revision: record.revision + 1,
        }),
      ).toEqual(missing);
      expect(await patchEmployee(f, record, { branch_ids: [f.branch, f.sibling, branch] })).toEqual(
        missing,
      );
    }
    expect(await create()).toMatchObject({ status: 403, body: { code: 'FEATURE_DISABLED' } });
    expect(await patchEmployee(f, record)).toMatchObject({
      status: 403,
      body: { code: 'FEATURE_DISABLED' },
    });
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
    await employeeGrants(f, [
      ['ALLOW', 'BUSINESS', f.business],
      ['DENY', 'BUSINESS', f.secondBusiness],
    ]);
  }
});

it('the shared access reader never evaluates foreign branches as part of the employee business', async () => {
  const access = createEmployeeDetailAccess();
  expect(
    await f.db.withTenant(f.company, (tx) =>
      access.checkMany(tx, f.company, f.userId, f.business, [
        f.branch,
        f.otherBranch,
        f.foreignBranch,
        ids.newId(),
      ]),
    ),
  ).toEqual({ allowedBranchIds: [f.branch], featureEnabled: true });
});

it('own-business branches work over HTTP with branch-only ALLOW on create and update', async () => {
  await employeeGrants(f, [
    ['ALLOW', 'BRANCH', f.branch],
    ['ALLOW', 'BRANCH', f.sibling],
    ['DENY', 'BUSINESS', f.secondBusiness],
  ]);
  const response = await create({ primary_branch_id: f.sibling });
  expect(response).toMatchObject({
    status: 201,
    body: { business_id: f.business, primary_branch_id: f.sibling },
  });
  expect(
    await patchEmployee(f, record, {
      primary_branch_id: f.sibling,
      branch_ids: [f.sibling],
      branch_effective_date: '2026-10-15',
    }),
  ).toMatchObject({
    status: 200,
    body: { primary_branch_id: f.sibling, branch_ids: [f.sibling], revision: 2 },
  });
});
