import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { readSessionPerformerOptions, readSessionPerformers } from '../staff.module.ts';
import { sessionPerformerOptionsStatement } from '../queries/session-performer-options.query.ts';
import { ids, must, sessionFixture, type SessionFixture } from '../../../../test/service-session-picker.fixture.ts';

let f: SessionFixture;
const sibling = ids.newId();
const occurred_at = '2026-10-14T01:30:00Z';
beforeAll(async () => {
  f = await sessionFixture();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES(${f.company},${sibling},${f.business},'Synthetic sibling')`;
});
afterAll(async () => { await f?.close(); });
const read = (at = occurred_at) => f.db.withTenant(f.company, (tx) =>
  readSessionPerformerOptions(tx, f.company, f.business, f.branch, { occurred_at: at, limit: 20 }));

it('filters hire/contract/link boundaries before paging, independent of primary branch', async () => {
  const employee = must(f.employees[0]);
  await f.h.owner`UPDATE employees SET hire_date='2026-10-14',contract_end='2026-10-14',primary_branch_id=${sibling}
    WHERE company_id=${f.company} AND id=${employee}`;
  await f.h.owner`UPDATE employee_branches SET "to"='2026-10-14' WHERE company_id=${f.company} AND employee_id=${employee}`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${ids.newId()},${f.business},${employee},${f.branch},'2026-10-14','2026-10-15')`;
  expect((await read()).items.map((r) => r.id)).toContain(employee);
  for (const at of ['2026-10-13T08:00:00Z', '2026-10-15T08:00:00Z']) expect((await read(at)).items.map((r) => r.id)).not.toContain(employee);
  await f.h.owner`UPDATE employees SET contract_end=NULL WHERE company_id=${f.company} AND id=${employee}`;
  expect((await read('2026-10-15T08:00:00Z')).items.map((r) => r.id)).not.toContain(employee);
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${employee},${f.branch},'2026-10-15')`;
  expect((await read('2026-10-15T08:00:00Z')).items.map((r) => r.id)).toContain(employee);
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${employee}`;
  expect((await read()).items.map((r) => r.id)).not.toContain(employee);
});
it('uses branch working day and identical save-time facts; approved full/partial leave only warns', async () => {
  await f.h.owner`UPDATE branches SET timezone='America/New_York' WHERE company_id=${f.company} AND id=${f.branch}`;
  const employee = must(f.employees[1]);
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${ids.newId()},${f.business},${f.branch},${employee},'PARTIAL','2026-10-13','2026-10-13','21:00','23:00','America/New_York',
      '2026-10-14T01:00:00Z','2026-10-14T03:00:00Z','ANNUAL','APPROVED',${f.userId},now(),${f.ownerId},now())`;
  for (const [at, approved] of [['2026-10-14T00:59:59Z', false], ['2026-10-14T01:00:00Z', true], ['2026-10-14T02:59:59Z', true], ['2026-10-14T03:00:00Z', false]] as const)
    expect((await read(at)).items.find((r) => r.id === employee)?.approved_leave_warning).toBe(approved);
  await f.h.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    VALUES(${f.company},${ids.newId()},${f.business},${f.branch},${must(f.employees[2])},'FULL_DAY','2026-10-13','2026-10-13','America/New_York',
      '2026-10-13T04:00:00Z','2026-10-14T04:00:00Z','ANNUAL','APPROVED',${f.userId},now(),${f.ownerId},now())`;
  const page = await read();
  expect(page.items.find((r) => r.id === f.employees[2])).toMatchObject({ not_clocked_in_warning: true, approved_leave_warning: true });
  const saved = await f.db.withTenant(f.company, (tx) => readSessionPerformers(tx, f.company, f.business, f.branch, f.employees, new Date(occurred_at)));
  expect(page.items).toEqual(saved.filter((r) => r.eligible).map((r) => ({ id: r.id, name_ar: r.name_ar, name_en: r.name_en,
    not_clocked_in_warning: !r.clocked_in, approved_leave_warning: r.approved_leave })));
  await f.h.owner`UPDATE leave_requests SET status='CANCELLED',revoked_by=${f.ownerId},revoked_at='2026-01-01',revocation_reason='Synthetic revocation' WHERE company_id=${f.company}`;
  expect((await read()).items.every((r) => !r.approved_leave_warning)).toBe(true);
});
it('counts OPEN/CLOSED/MISSED_OUT including MANUAL; void, other-day and other-branch evidence do not count', async () => {
  const employee = must(f.employees[3]);
  const attendance = ids.newId();
  await f.h.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,geo,out_geo,closed_by,late_minutes)
    VALUES(${f.company},${attendance},${f.business},${f.branch},${employee},'2026-10-13','America/New_York',
      '2026-10-14T01:00:00Z','2026-10-14T02:00:00Z','CLOSED','QR','NONE','NONE','EMPLOYEE',0)`;
  const warning = async (at = occurred_at) => (await read(at)).items.find((r) => r.id === employee)?.not_clocked_in_warning;
  expect(await warning()).toBe(false);
  for (const status of ['OPEN', 'MISSED_OUT']) {
    await f.h.owner`UPDATE attendance_sessions SET status=${status},clock_out=${status === 'OPEN' ? null : '2026-10-14T17:00:00Z'},
      closed_by=${status === 'OPEN' ? null : 'MISSED_OUT'},out_geo=${status === 'OPEN' ? null : 'NONE'} WHERE company_id=${f.company} AND id=${attendance}`;
    expect(await warning()).toBe(false);
  }
  const request = ids.newId();
  await f.h.owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,status,reason,requested_by,requested_at,clock_in,clock_out,working_date,timezone)
    VALUES(${f.company},${request},${f.business},${f.branch},${employee},'ADD_SESSION','PENDING','Synthetic manual clock',${f.userId},now(),
      '2026-10-14T01:00:00Z','2026-10-14T02:00:00Z','2026-10-13','America/New_York')`;
  await f.h.owner`UPDATE attendance_sessions SET status='CLOSED',clock_out='2026-10-14T02:00:00Z',closed_by='MANUAL',source='MANUAL',change_request_id=${request} WHERE company_id=${f.company} AND id=${attendance}`;
  expect(await warning()).toBe(false);
  expect(await warning('2026-10-15T01:30:00Z')).toBe(true);
  await f.h.owner`UPDATE attendance_sessions SET branch_id=${sibling} WHERE company_id=${f.company} AND id=${attendance}`;
  expect(await warning()).toBe(true);
  await f.h.owner`UPDATE attendance_sessions SET branch_id=${f.branch},voided_at=now(),voided_by=${f.ownerId},void_request_id=${request} WHERE company_id=${f.company} AND id=${attendance}`;
  expect(await warning()).toBe(true);
});
it('EXPLAIN ANALYZE uses existing employee/link/clock/leave indexes for exact searched and cursor SQL', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    for (const cursor of [undefined, must(f.employees[0])]) {
      const query = { occurred_at, q: 'synthetic', limit: 2, ...(cursor === undefined ? {} : { cursor }) };
      const plan = JSON.stringify(await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${sessionPerformerOptionsStatement(f.company, f.business, f.branch, '2026-10-13', query)}`));
      for (const name of ['employees_', 'employee_branches_', 'attendance_sessions_', 'leave_requests_']) expect(plan).toContain(name);
      expect(plan).not.toContain('Seq Scan');
    }
  });
});
