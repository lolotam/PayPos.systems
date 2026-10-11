import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceEmployeePage, attendanceEmployeesQuery } from '@pospay/contracts';
import {
  attendanceEmployeesFixture,
  type AttendanceEmployeesFixture,
} from './attendance-employees.fixture.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: AttendanceEmployeesFixture;
beforeAll(async () => {
  f = await attendanceEmployeesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const send = (query = '', branch = f.branch, business = f.business) =>
  f.h.send('GET', `/v1/businesses/${business}/branches/${branch}/attendance-employees${query}`, {
    cookie: f.approverCookie,
    company: f.company,
  });

it('manager of A reads A without employee-management permission; B, foreign and missing branches share NOT_FOUND', async () => {
  await asRole(f, 'branch_manager');
  const managementDeny = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${managementDeny},${f.approverMember},'manage:employees:business','DENY','BUSINESS',${f.business},'synthetic',${f.userId})`;
  const allowed = await send('?search=Picker');
  expect(allowed.status).toBe(200);
  expect(attendanceEmployeePage.parse(allowed.body).items).toEqual(
    expect.arrayContaining(f.expected),
  );
  const directory = await f.h.send('GET', `/v1/businesses/${f.business}/employees`, {
    cookie: f.approverCookie,
    company: f.company,
  });
  expect(directory.status).toBe(200);
  expect(directory.body).toEqual({ items: [], next_cursor: null });
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${managementDeny}`;
  const denied = await send('', f.secondBranch);
  expect(denied.status).toBe(404);
  expect(denied.body.code).toBe('NOT_FOUND');
  for (const branch of [f.foreignBranch, leaveIds.newId()]) {
    const result = await send('', branch);
    expect(result.status).toBe(404);
    expect(result.body).toEqual(denied.body);
  }
});
it('personal DENY overrides a manager grant and a reader without the request permission is hidden', async () => {
  await asRole(f, 'general_manager');
  const override = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${override},${f.approverMember},'request:attendance-change:branch','DENY','BRANCH',${f.branch},'synthetic',${f.userId})`;
  try {
    const result = await send();
    expect(result.status).toBe(404);
    expect(result.body.code).toBe('NOT_FOUND');
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${override}`;
  }
  await asRole(f, 'accountant');
  expect((await send()).status).toBe(404);
});
it('owner scope and business/branch consistency reuse the board adapter with lower-case ids', async () => {
  await asRole(f, 'owner');
  expect((await send('', f.secondBranch)).status).toBe(200);
  const canonical = await send();
  expect((await send('', f.branch.toUpperCase(), f.business.toUpperCase())).body).toEqual(
    canonical.body,
  );
  for (const business of [f.secondBusiness, f.secondBusiness.toUpperCase(), leaveIds.newId()])
    expect((await send('', f.branch.toUpperCase(), business)).status).toBe(404);
});
it('JSON has only the allowed employee fields and the default page size and keyset pagination follow the contract', async () => {
  expect(attendanceEmployeesQuery.parse({})).toEqual({ limit: 50 });
  const first = await send('?limit=1&search=Picker');
  expect(first.status).toBe(200);
  const page = attendanceEmployeePage.parse(first.body);
  expect(page.items).toHaveLength(1);
  const next = await send(
    `?limit=1&search=Picker&cursor=${encodeURIComponent(page.next_cursor ?? '')}`,
  );
  expect(next.status).toBe(200);
  expect(attendanceEmployeePage.parse(next.body).items[0]?.id).not.toBe(page.items[0]?.id);
  const full = await send('?search=Picker');
  const fullPage = attendanceEmployeePage.parse(full.body);
  expect(fullPage.items).toHaveLength(f.expected.length);
  for (const employee of fullPage.items)
    expect(Object.keys(employee).sort()).toEqual(['id', 'name_ar', 'name_en']);
  for (const forbidden of ['phone', 'salary', 'iban', 'document', 'role', 'user_id'])
    expect(full.text).not.toContain(forbidden);
});
it('rejects malformed cursors and search/limit bounds, and accepts the maximum limit', async () => {
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?cursor=invalid',
    '?cursor=%5B%22x%22%5D',
    `?search=${'a'.repeat(101)}`,
  ]) {
    const result = await send(query);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
  }
  expect((await send('?limit=100')).status).toBe(200);
});
it('disabled staff feature returns FEATURE_DISABLED after permission scope succeeds', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'synthetic',${f.userId})`;
  try {
    const result = await send();
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
