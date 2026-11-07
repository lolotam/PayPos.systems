import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import { termsFor } from './employees.fixture.ts';
import { leaveAuthority as readLeaveAccess } from '../persistence/leave-context.adapter.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';
import {
  historyClear,
  historyLeave,
  historyRead,
  historySession,
  historyShift,
  historyQuery,
  historyNow,
  leaveContext,
  leaveFixture,
  leaveIds,
  type LeaveFixture,
} from './leave-history.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
beforeEach(async () => {
  await historyClear(f);
  await f.h
    .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND permission_code IN
    ('read:attendance:branch','create:leave:branch')`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
async function deny(code: string, branch?: string) {
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,
    scope_type,scope_id,reason,granted_by) VALUES(${f.company},${leaveIds.newId()},${f.memberId},${code},'DENY',
    ${branch ? 'BRANCH' : 'BUSINESS'},${branch ?? f.business},'Synthetic deny',${f.userId})`;
}
it('identity attendanceRead honours branch DENY with business ALLOW, own gives []', async () => {
  await deny('read:attendance:branch', f.secondBranch);
  const access = (subject?: string) =>
    f.db.withTenant(f.company, (tx) =>
      readLeaveAccess(
        tx,
        f.company,
        f.userId,
        f.business,
        [f.branch, f.secondBranch],
        new Date(historyNow),
        subject,
      ),
    );
  expect((await access()).attendanceRead).toEqual([f.branch]);
  expect((await access(f.userId)).attendanceRead).toEqual([]);
});
it('LH-13b/15/18: DENY hides branch absence/neutral rows, keeps leave rows; empty scope omits last absence', async () => {
  await historyShift(f, '2026-10-01', { branch: f.secondBranch });
  await historyShift(f, '2026-10-02', { branch: f.secondBranch });
  await historySession(f, '2026-10-02');
  const leave = await historyLeave(f, '2026-09-01', { branch: f.secondBranch });
  await deny('read:attendance:branch', f.secondBranch);
  const page = await historyRead(f);
  expect(page.absence_branch_ids).toEqual([f.branch]);
  expect(page.items.map((r) => r.id)).toEqual([leave]);
  expect(page.last_taken?.unexcused_absence).toBeNull();
  await deny('read:attendance:branch');
  const onlyLeave = await historyRead(f);
  expect(onlyLeave.absence_branch_ids).toEqual([]);
  expect(onlyLeave.last_taken).not.toHaveProperty('unexcused_absence');
  expect(onlyLeave.items.map((r) => r.id)).toEqual([leave]);
});
it.each(['APPROVED', 'PENDING'])(
  'LH-13c/25: hidden %s leave gives neutral context only',
  async (status) => {
    await historyShift(f, '2026-10-01');
    await historyLeave(f, '2026-10-01', { branch: f.secondBranch, status });
    await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
    try {
      const page = await historyRead(f);
      expect(page.items).toMatchObject([{ row_type: 'COVERED_ELSEWHERE', branch_id: f.branch }]);
      expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
        [
          'branch_id',
          'employee_id',
          'employee_name_ar',
          'employee_name_en',
          'employee_number',
          'id',
          'row_type',
          'shift',
          'working_date',
        ].sort(),
      );
      expect(page.last_taken?.annual).toBeNull();
    } finally {
      await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
      WHERE company_id=${f.company} AND id=${f.memberId}`;
    }
  },
);
it('LH-26: each fact uses its own read scope; create permission never controls visibility', async () => {
  await deny('read:attendance:branch', f.secondBranch);
  await deny('create:leave:branch', f.secondBranch);
  await historyShift(f, '2026-10-01');
  await historySession(f, '2026-10-01', { branch: f.secondBranch });
  expect((await historyRead(f)).items[0]?.row_type).toBe('COVERED_ELSEWHERE');
  const leave = await historyLeave(f, '2026-10-01', { branch: f.secondBranch });
  const page = await historyRead(f);
  expect(page.items.map((r) => r.id)).toEqual([leave]);
  expect(page.request_branch_ids).toEqual([f.branch]);
  expect(page.last_taken?.annual).toEqual({ from: '2026-10-01', to: '2026-10-01' });
});
it('an existing employee attached only outside the read branches is 404', async () => {
  const employee = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: { ...termsFor(f, 'Synthetic outside branch'), primary_branch_id: f.secondBranch },
  });
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
  try {
    const response = await f.h.app.inject({
      method: 'GET',
      url: `/v1/businesses/${f.business}/employees/${employee.id}/leave-history?from=2026-01-01&to=2026-11-07`,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
    });
    expect(response.statusCode).toBe(404);
  } finally {
    await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
      WHERE company_id=${f.company} AND id=${f.memberId}`;
  }
});
it('access: feature disabled, cashier/no scope, missing employee, deleted employee and cross-tenant refuse', async () => {
  const access = createLeaveReadAccess({ now: () => new Date(historyNow) });
  const read = (context = leaveContext(f), company = f.company) =>
    f.db.withTenant(company, (tx) => getEmployeeLeaveHistory(tx, context, historyQuery(), access));
  expect(await read({ ...leaveContext(f), employeeId: leaveIds.newId() })).toBeNull();
  expect(await read(leaveContext(f), f.otherCompany)).toBeNull();
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'Synthetic feature',${f.userId})`;
  expect(await read()).toBe('FEATURE_DISABLED');
  await f.h
    .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  await f.h
    .owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.employee.id}`;
  expect(await read()).toBeNull();
  await f.h
    .owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${f.employee.id}`;
  const cashier = SYSTEM_ROLES.find((r) => r.code === 'cashier');
  await f.h
    .owner`UPDATE memberships SET role_id=${cashier?.id as string} WHERE company_id=${f.company} AND id=${f.memberId}`;
  expect(await read()).toBeNull();
});
