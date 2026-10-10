import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequestPage, type AttendanceChangeListQuery } from '@pospay/contracts';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { linkEmployee, seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { createAttendanceChangeReadAccess } from '../persistence/attendance-change-context.adapter.ts';
import { listAttendanceChangeRequests } from '../queries/attendance-change-requests.query.ts';

let f: ChangeFixture;
let here: string;
let there: string;
beforeAll(async () => {
  f = await attendanceChangeFixture();
  await asRole(f, 'accountant');
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${leaveIds.newId()},${f.approverMember},'decide:attendance-change:company','ALLOW','BRANCH',${f.branch},'Synthetic branch delegation',${f.owner})`;
  const subject = await linkEmployee(f, null);
  const owner = changeActor(f, undefined, f.owner);
  here = (await f.fileChange.execute(owner, { ...changeInput(f), employee_id: subject })).id;
  const session_id = await seedSession(f, { employeeId: subject, branchId: f.secondBranch });
  there = (
    await f.fileChange.execute(changeActor(f, undefined, f.owner), {
      ...changeInput(f),
      employee_id: subject,
      kind: 'VOID_SESSION',
      session_id,
    })
  ).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const list = (userId: string, query: Partial<AttendanceChangeListQuery> = {}) =>
  f.db.withTenant(f.company, (tx) =>
    listAttendanceChangeRequests(
      tx,
      { companyId: f.company, businessId: f.business, userId },
      { limit: 100, ...query },
      createAttendanceChangeReadAccess(f.clock),
    ),
  );

it('a delegate with a branch-scoped decide grant lists only that branch (PR #148 review P1)', async () => {
  const page = attendanceChangeRequestPage.parse(await list(f.approverId));
  expect(page.items.map((r) => r.id)).toContain(here);
  expect(page.items.map((r) => r.id)).not.toContain(there);
  expect(page.items.every((r) => r.branch_id === f.branch)).toBe(true);
  expect(await list(f.approverId, { branch_id: f.secondBranch })).toBeNull();
});

it('the owner still lists every branch of the business', async () => {
  const page = attendanceChangeRequestPage.parse(await list(f.owner));
  expect(page.items.map((r) => r.id)).toEqual(expect.arrayContaining([here, there]));
});
