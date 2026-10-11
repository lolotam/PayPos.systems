import { employeeDefaultShifts } from '@pospay/contracts';
import { OWNER_ROLE_ID } from '@pospay/db';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { salaryIds } from './salary.fixture.ts';
import {
  defaultHoursFixture, hoursCommand, hoursHttp, salmiyaDefaults, type DefaultHoursFixture,
} from './employee-default-shifts.fixture.ts';

let f: DefaultHoursFixture, readerRole: string;
const hawalliDefaults = [{ day: 6, start: '14:00', end: '22:00' }];

beforeAll(async () => {
  f = await defaultHoursFixture();
  await f.setHours.execute(hoursCommand(f));
  await f.setHours.execute(hoursCommand(f, hawalliDefaults, f.secondBranch));
  await f.h.owner`UPDATE branches SET timezone='Pacific/Honolulu'
    WHERE company_id=${f.company} AND id=${f.secondBranch}`;
  await endHawalliLink();
  readerRole = salaryIds.newId();
  await f.h.owner`INSERT INTO roles(company_id,id,code,name_en)
    VALUES(${f.company},${readerRole},'synthetic_scoped_hours_reader','Synthetic scoped reader')`;
});
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
beforeEach(async () => {
  await f.h.owner`DELETE FROM permission_overrides
    WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
  await f.h.owner`UPDATE memberships SET role_id=${OWNER_ROLE_ID},role_owner_key='global',
    scope_type='COMPANY',scope_id=${f.company} WHERE company_id=${f.company} AND id=${f.memberId}`;
});

async function endHawalliLink() {
  await f.h.owner`UPDATE employee_branches SET "to"=
    (CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Honolulu')::date-1
    WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
}

async function reader(scope: 'BRANCH' | 'BUSINESS') {
  await f.h.owner`UPDATE memberships SET role_id=${readerRole},role_owner_key=${f.company},
    scope_type=${scope},scope_id=${scope === 'BRANCH' ? f.branch : f.business}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
}

async function grant(permission: string, effect: 'ALLOW' | 'DENY', scope: 'BRANCH' | 'BUSINESS', scopeId: string) {
  await f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${salaryIds.newId()},${f.memberId},${permission},${effect},${scope},${scopeId},
      'Synthetic hours scope decision',${f.userId})`;
}

it('DH-04 GET hides ended-branch defaults from a branch-scoped manager while the owner sees both', async () => {
  const owner = await hoursHttp(f, 'GET', f.hoursPath);
  expect(owner.status).toBe(200);
  const view = employeeDefaultShifts.parse(owner.body);
  expect(view.can_manage).toBe(true);
  expect(view.branches.map((branch) => branch.branch_id)).toEqual([f.branch, f.secondBranch].sort());
  expect(view.branches.find((branch) => branch.branch_id === f.secondBranch)).toMatchObject({
    linked: false, shifts: hawalliDefaults,
  });
  await reader('BRANCH');
  await grant('manage:employees:business', 'ALLOW', 'BRANCH', f.branch);
  const manager = await hoursHttp(f, 'GET', f.hoursPath);
  expect(manager.status).toBe(200);
  expect(employeeDefaultShifts.parse(manager.body)).toMatchObject({ can_manage: false });
  expect(employeeDefaultShifts.parse(manager.body).branches).toEqual([
    { branch_id: f.branch, linked: true, shifts: salmiyaDefaults, updated_at: '2026-10-11T10:00:00.000Z' },
  ]);
});

it('DH-04 GET preserves ended-branch defaults for a business-scoped reader grant', async () => {
  await reader('BUSINESS');
  await grant('manage:employees:business', 'ALLOW', 'BUSINESS', f.business);
  const response = await hoursHttp(f, 'GET', f.hoursPath);
  expect(response.status).toBe(200);
  const view = employeeDefaultShifts.parse(response.body);
  expect(view.can_manage).toBe(false);
  expect(view.branches.map((branch) => branch.branch_id)).toEqual([f.branch, f.secondBranch].sort());
  expect(view.branches.find((branch) => branch.branch_id === f.secondBranch)).toMatchObject({
    linked: false, shifts: hawalliDefaults,
  });
});

it('DH-04 GET branch DENY wins over a business ALLOW for ended-branch defaults', async () => {
  await reader('BUSINESS');
  await grant('manage:employees:business', 'ALLOW', 'BUSINESS', f.business);
  await grant('manage:employees:business', 'DENY', 'BRANCH', f.secondBranch);
  const response = await hoursHttp(f, 'GET', f.hoursPath);
  expect(response.status).toBe(200);
  expect(employeeDefaultShifts.parse(response.body).branches.map((branch) => branch.branch_id)).toEqual([f.branch]);
});

it('DH-04 PUT response filters ended defaults by manage decisions and preserves can_manage', async () => {
  await reader('BUSINESS');
  await grant('manage:employee-hours:business', 'ALLOW', 'BUSINESS', f.business);
  await grant('manage:employee-hours:business', 'DENY', 'BRANCH', f.secondBranch);
  const response = await hoursHttp(f, 'PUT', f.putPath(), { shifts: salmiyaDefaults });
  expect(response.status).toBe(200);
  const view = employeeDefaultShifts.parse(response.body);
  expect(view.can_manage).toBe(true);
  expect(view.branches.map((branch) => branch.branch_id)).toEqual([f.branch]);
});

it('DH-04 GET still returns 404 when a current branch is outside the reader scope', async () => {
  await reader('BRANCH');
  await grant('manage:employees:business', 'ALLOW', 'BRANCH', f.branch);
  const linkId = salaryIds.newId();
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${linkId},${f.business},${f.employee.id},${f.secondBranch},
      (CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Honolulu')::date-1)`;
  try {
    const response = await hoursHttp(f, 'GET', f.hoursPath);
    const missing = await hoursHttp(f, 'GET', f.hoursPath.replace(f.employee.id, salaryIds.newId()));
    expect(response.status).toBe(404);
    expect(response.body).toEqual(missing.body);
  } finally {
    await f.h.owner`UPDATE employee_branches SET "to"=(CURRENT_TIMESTAMP AT TIME ZONE 'Pacific/Honolulu')::date
      WHERE company_id=${f.company} AND id=${linkId}`;
  }
});
