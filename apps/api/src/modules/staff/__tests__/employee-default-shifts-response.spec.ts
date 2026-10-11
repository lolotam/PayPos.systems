import { employeeDefaultShifts } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { OWNER_ROLE_ID } from '@pospay/db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { DATABASE } from '../../../shared/database.token.ts';
import { defaultHoursFixture, hoursCommand, hoursHttp, salmiyaDefaults, type DefaultHoursFixture } from './employee-default-shifts.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: DefaultHoursFixture;
let readerRole: string;
beforeAll(async () => {
  f = await defaultHoursFixture();
  await f.setHours.execute(hoursCommand(f));
  await f.h.owner`UPDATE employee_branches SET "to"='2026-01-02' WHERE company_id=${f.company}
    AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  readerRole = salaryIds.newId();
  await f.h.owner`INSERT INTO roles(company_id,id,code,name_en)
    VALUES(${f.company},${readerRole},'synthetic_response_reader','Synthetic response reader')`;
});
afterAll(async () => { vi.restoreAllMocks(); await f?.db.close(); await f?.h.close(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
  await f.h.owner`UPDATE memberships SET role_id=${OWNER_ROLE_ID},role_owner_key='global',
    scope_type='COMPANY',scope_id=${f.company} WHERE company_id=${f.company} AND id=${f.memberId}`;
  await f.setHours.execute(hoursCommand(f));
  await f.h.owner`UPDATE memberships SET role_id=${readerRole},role_owner_key=${f.company},
    scope_type='BRANCH',scope_id=${f.branch} WHERE company_id=${f.company} AND id=${f.memberId}`;
  for (const permission of ['manage:employee-hours:business', 'manage:employees:business']) {
    await f.h.owner`INSERT INTO permission_overrides
      (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${salaryIds.newId()},${f.memberId},${permission},'ALLOW','BRANCH',${f.branch},
        'Synthetic response grant',${f.userId})`;
  }
});

function afterCommit(effect: () => Promise<void>) {
  const database = f.h.app.get<TenantWrappers>(DATABASE);
  const original = database.withTenant.bind(database);
  const spy = vi.spyOn(database, 'withTenant');
  let ran = false;
  spy.mockImplementation(async (companyId, work, options) => {
    const first = f.h.calls.statements.length;
    const result = await original(companyId, work, options);
    const write = f.h.calls.statements.slice(first).some(({ sql }) =>
      sql.includes('FROM employees WHERE') && sql.includes('FOR NO KEY UPDATE'));
    if (write) {
      spy.mockRestore();
      ran = true;
      await effect();
    }
    return result;
  });
  return () => ran;
}

it.each([['grant', 'change'], ['feature', 'change'], ['grant', 'no-op']] as const)(
  'PUT returns saved hours after post-commit %s revocation on a %s; GET applies the new authority', async (change, kind) => {
  const shifts = kind === 'no-op' ? salmiyaDefaults
    : [{ day: 0, start: '10:00', end: '22:00', break_start: '15:00', break_end: '16:00' }];
  const before = await f.h.owner`SELECT count(*)::int AS count FROM audit_log
    WHERE company_id=${f.company} AND entity='employee_default_shifts'`;
  const ran = afterCommit(async () => {
    const persisted = await f.h.owner`SELECT left(start::text,5) AS start FROM employee_default_shifts
      WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.branch} ORDER BY day`;
    expect(persisted).toEqual(shifts.map(({ start }) => ({ start })));
    if (change === 'grant') await f.h.owner`DELETE FROM permission_overrides
      WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
    else await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
      VALUES(${f.company},'staff',false,'Synthetic post-commit disable',${f.userId})`;
  });
  const saved = await hoursHttp(f, 'PUT', f.putPath(), { shifts });
  expect(ran()).toBe(true);
  expect(saved.status).toBe(200);
  expect(employeeDefaultShifts.parse(saved.body)).toMatchObject({ employee_id: f.employee.id, can_manage: true,
    branches: [{ branch_id: f.branch, linked: true, can_manage: true, shifts }] });
  const audits = await f.h.owner`SELECT count(*)::int AS count FROM audit_log
    WHERE company_id=${f.company} AND entity='employee_default_shifts'`;
  expect(audits[0]?.['count']).toBe(Number(before[0]?.['count']) + (kind === 'no-op' ? 0 : 1));
  const next = await hoursHttp(f, 'GET', f.hoursPath);
  expect(next.body['code']).toBe(change === 'grant' ? 'NOT_FOUND' : 'FEATURE_DISABLED');
});

it('PUT returns the committed clear and its timestamp shape after the grant is revoked', async () => {
  const ran = afterCommit(async () => {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${f.memberId}`;
  });
  const saved = await hoursHttp(f, 'PUT', f.putPath(), { shifts: [] });
  expect(ran()).toBe(true);
  expect(saved.status).toBe(200);
  expect(employeeDefaultShifts.parse(saved.body).branches).toEqual([
    { branch_id: f.branch, linked: true, can_manage: true, shifts: [], updated_at: null },
  ]);
});

it('use-case port returns the authoritative snapshot on a no-op and on a changed week', async () => {
  const first = await f.setHours.execute(hoursCommand(f, salmiyaDefaults));
  const replay = await f.setHours.execute(hoursCommand(f, salmiyaDefaults));
  expect(employeeDefaultShifts.parse(replay)).toEqual(employeeDefaultShifts.parse(first));
});
