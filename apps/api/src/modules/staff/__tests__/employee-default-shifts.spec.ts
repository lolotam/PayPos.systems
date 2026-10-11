import { employeeDefaultShifts } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { salaryIds } from './salary.fixture.ts';
import { defaultHoursFixture, hoursCommand, hoursHttp, hoursDevice, salmiyaDefaults, type DefaultHoursFixture } from './employee-default-shifts.fixture.ts';
import { branchScheduleStatement } from '../queries/schedule-week.query.ts';
import { employeeDefaultShiftsStatement } from '../queries/employee-default-shifts.query.ts';
import { sql } from 'drizzle-orm';
import { schedulesFixture, scheduleActor, setWeek, testPattern, type SchedulesFixture } from './schedules.fixture.ts';

let f: DefaultHoursFixture;
beforeAll(async () => { f = await defaultHoursFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });
const auditRows = () => f.h.owner`SELECT actor_user_id,entity_id,before,after FROM audit_log
  WHERE company_id=${f.company} AND entity='employee_default_shifts' ORDER BY created_at,id`;

it('DH-01/02 sets independent branch defaults, reads the shape and audits only actual changes', async () => {
  const first = await hoursHttp(f, 'PUT', f.putPath(), { shifts: salmiyaDefaults });
  expect(first.status).toBe(200);
  expect(employeeDefaultShifts.parse(first.body)).toMatchObject({ employee_id: f.employee.id, can_manage: true });
  expect((await auditRows())).toHaveLength(1);
  await f.setHours.execute(hoursCommand(f, [...salmiyaDefaults].reverse()));
  expect(await auditRows()).toHaveLength(1);
  const hawalli = [{ day: 6, start: '14:00', end: '22:00' }];
  await f.setHours.execute(hoursCommand(f, hawalli, f.secondBranch));
  const view = employeeDefaultShifts.parse((await hoursHttp(f, 'GET', f.hoursPath)).body);
  expect(view.branches.find((b) => b.branch_id === f.branch)?.shifts).toEqual(salmiyaDefaults);
  expect(view.branches.find((b) => b.branch_id === f.secondBranch)?.shifts).toMatchObject(hawalli);
  expect(await auditRows()).toHaveLength(2);
  expect((await auditRows())[0]).toMatchObject({ actor_user_id: f.userId, entity_id: f.employee.id,
    before: { branch_id: f.branch, shifts: [] }, after: { branch_id: f.branch, shifts: salmiyaDefaults } });
});

it.each([
  [[{ day: 0, start: '09:00', end: '02:00' }], 'SCHEDULE_SHIFT_INVALID'],
  [[{ day: 0, start: '09:00', end: '17:00' }, { day: 0, start: '18:00', end: '20:00' }], 'SCHEDULE_DAY_LIMIT_EXCEEDED'],
  [[{ day: 0, start: '09:00', end: '17:00', break_start: '09:00', break_end: '10:00' }], 'SCHEDULE_BREAK_INVALID'],
] as const)('DH-03 refuses invalid defaults without any change: %s', async (shifts, code) => {
  const before = await auditRows();
  const rows = await f.h.owner`SELECT to_jsonb(d) AS row FROM employee_default_shifts d
    WHERE company_id=${f.company} ORDER BY employee_id,branch_id,day`;
  const result = await hoursHttp(f, 'PUT', f.putPath(), { shifts });
  expect(result.body['code']).toBe(code);
  expect(await auditRows()).toEqual(before);
  expect(await f.h.owner`SELECT to_jsonb(d) AS row FROM employee_default_shifts d
    WHERE company_id=${f.company} ORDER BY employee_id,branch_id,day`).toEqual(rows);
});

it('DH-04 permits the owner and an explicit human grant; refuses non-holders and devices', async () => {
  const role = salaryIds.newId();
  await f.h.owner`INSERT INTO roles(company_id,id,code,name_en) VALUES(${f.company},${role},'synthetic_hours_reader','Synthetic reader')`;
  await f.h.owner`UPDATE memberships SET role_id=${role},role_owner_key=${f.company} WHERE company_id=${f.company} AND id=${f.memberId}`;
  expect(employeeDefaultShifts.parse((await hoursHttp(f, 'GET', f.hoursPath)).body).can_manage).toBe(false);
  expect((await hoursHttp(f, 'PUT', f.putPath(), { shifts: [] })).body['code']).toBe('FORBIDDEN');
  const grant = salaryIds.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${grant},${f.memberId},'manage:employee-hours:business','ALLOW','BUSINESS',${f.business},'Synthetic owner grant',${f.userId})`;
  expect((await hoursHttp(f, 'PUT', f.putPath(), { shifts: salmiyaDefaults })).status).toBe(200);
  await f.h.owner`UPDATE permission_overrides SET effect='DENY' WHERE company_id=${f.company} AND id=${grant}`;
  await expect(f.setHours.execute(hoursCommand(f))).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${grant}`;
  await f.h.owner`UPDATE memberships SET role_id='01920000-0000-7000-8000-000000000101',role_owner_key='global' WHERE company_id=${f.company} AND id=${f.memberId}`;
  const token = await hoursDevice(f);
  const response = await f.h.app.inject({ method: 'PUT', url: f.putPath(), payload: { shifts: [] },
    headers: { authorization: `Device ${token}`, 'x-company-id': f.company, origin: 'http://admin.test' } });
  expect(response.statusCode).toBe(403);
});

it('DH-05 refuses unlinked, ended and future links; DH-06 clears and keeps unlinked stored defaults', async () => {
  await expect(f.setHours.execute(hoursCommand(f, [], f.otherBranch))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-11' WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  await expect(f.setHours.execute(hoursCommand(f, [], f.secondBranch))).rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_LINKED' });
  const view = employeeDefaultShifts.parse((await hoursHttp(f, 'GET', f.hoursPath)).body);
  expect(view.branches.find((b) => b.branch_id === f.secondBranch)).toMatchObject({ linked: false });
  await f.h.owner`UPDATE employee_branches SET "from"='2026-10-12',"to"=NULL
    WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  await expect(f.setHours.execute(hoursCommand(f, [], f.secondBranch))).rejects.toMatchObject({ code: 'EMPLOYEE_BRANCH_NOT_LINKED' });
  const before = (await auditRows()).length;
  await f.setHours.execute(hoursCommand(f, []));
  await f.setHours.execute(hoursCommand(f, []));
  expect(await auditRows()).toHaveLength(before + 1);
});

it('DH-09 serializes concurrent changes and audits the committed predecessor', async () => {
  const before = (await auditRows()).length;
  await Promise.all([
    f.setHours.execute(hoursCommand(f, [{ day: 0, start: '09:00', end: '17:00' }])),
    f.setHours.execute(hoursCommand(f, [{ day: 0, start: '10:00', end: '18:00' }])),
  ]);
  const audits = (await auditRows()).slice(before);
  expect(audits).toHaveLength(2);
  expect(audits.some((audit, index) => JSON.stringify(audit['before']) === JSON.stringify(audits[1 - index]?.['after']))).toBe(true);
});

it('EXPLAIN checks profile and grid defaults use tenant PK/index scans', async () => {
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return Promise.all([
      tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${employeeDefaultShiftsStatement(f.context)}`),
      tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${branchScheduleStatement(f.company, f.business, f.branch, { week_start: '2026-10-10', limit: 20 })}`),
    ]);
  });
  for (const plan of plans) expect(JSON.stringify(plan)).toMatch(/employee_default_shifts_(pkey|company_business_branch_idx)/);
});

it('DH-08 changing a default leaves saved weeks and templates byte-for-byte unchanged', async () => {
  const s: SchedulesFixture = await schedulesFixture();
  try {
    await setWeek(s, testPattern);
    await s.createTemplate.execute({ ...scheduleActor(s), input: { name_en: 'Synthetic saved template', shifts: testPattern } });
    const saved = () => s.h.owner`SELECT to_jsonb(s) AS row FROM staff_schedules s WHERE company_id=${s.company}`;
    const templates = () => s.h.owner`SELECT to_jsonb(t) AS row FROM staff_shift_templates t WHERE company_id=${s.company}`;
    const before = await saved(), beforeTemplates = await templates();
    const beforeShifts = await s.h.owner`SELECT to_jsonb(ss) AS row FROM staff_schedule_shifts ss WHERE company_id=${s.company} ORDER BY id`;
    await s.h.owner`UPDATE memberships SET role_id='01920000-0000-7000-8000-000000000101',role_owner_key='global'
      WHERE company_id=${s.company} AND id=${s.memberId}`;
    const { createEmployeeDefaultShiftsTransactions } = await import('../persistence/employee-default-shifts.adapter.ts');
    const { SetEmployeeDefaultShiftsUseCase } = await import('../use-cases/set-employee-default-shifts/set-employee-default-shifts.usecase.ts');
    const setter = new SetEmployeeDefaultShiftsUseCase(createEmployeeDefaultShiftsTransactions(s.db, salaryIds), { now: () => new Date('2026-10-11T10:00:00Z') });
    await setter.execute({ ...scheduleActor(s), employeeId: s.employee.id, branchId: s.branch, input: { shifts: salmiyaDefaults } });
    await setter.execute({ ...scheduleActor(s), employeeId: s.employee.id, branchId: s.branch, input: { shifts: [] } });
    expect(await saved()).toEqual(before);
    expect(await templates()).toEqual(beforeTemplates);
    expect(await s.h.owner`SELECT to_jsonb(ss) AS row FROM staff_schedule_shifts ss WHERE company_id=${s.company} ORDER BY id`).toEqual(beforeShifts);
  } finally { await s.db.close(); await s.h.close(); }
});
