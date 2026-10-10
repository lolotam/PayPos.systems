import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { staffSchedule } from '@pospay/contracts';
import { scheduleRecord } from '../persistence/schedule-records.ts';
import { SetScheduleUseCase } from '../use-cases/set-schedule/set-schedule.usecase.ts';
import { materializeSchedule, requirePastScheduleReason } from '../domain/schedules.ts';
import {
  schedulesFixture,
  scheduleActor,
  setWeek,
  testPattern,
  scheduleIds,
  type SchedulesFixture,
} from './schedules.fixture.ts';
let f: SchedulesFixture;
beforeAll(async () => {
  f = await schedulesFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('on Monday changes only Friday without a reason, using the real Postgres before snapshot', async () => {
  const employee = await f.useCase.execute({
    ...scheduleActor(f),
    input: {
      primary_branch_id: f.branch,
      name_en: 'Synthetic Monday correction',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
  });
  const original = await setWeek(
    f,
    [
      { day: 0, start: '09:00', end: '12:00' },
      { day: 0, start: '14:00', end: '18:00' },
      { day: 6, start: '09:00', end: '12:00' },
    ],
    { employee: employee.id },
  );
  const before = await f.db.withTenant(f.company, (tx) =>
    scheduleRecord(tx, f.company, f.business, f.branch, employee.id, original.week_start),
  );
  if (!before) throw new Error('Synthetic schedule snapshot missing');
  const afterPattern = [
    { day: 0, start: '14:00', end: '18:00' },
    { day: 6, start: '10:00', end: '13:00' },
    { day: 0, start: '09:00', end: '12:00' },
  ];
  const after = materializeSchedule(original.week_start, afterPattern, original.timezone, 3);
  expect(Object.keys(before.shifts[0] ?? {})).not.toEqual(Object.keys(original.shifts[0] ?? {}));
  expect(() =>
    requirePastScheduleReason([...before.shifts].reverse(), after, '2026-10-05'),
  ).not.toThrow();
  const monday = new SetScheduleUseCase(f.transactions, scheduleIds, {
    now: () => new Date('2026-10-05T10:00:00Z'),
  });
  const saved = await monday.execute({
    ...scheduleActor(f),
    branchId: f.branch,
    employeeId: employee.id,
    input: { week_start: original.week_start, expected_revision: 1, shifts: afterPattern },
  });
  expect(saved.revision).toBe(2);
  const [audit] = await f.h
    .owner`SELECT before,after FROM audit_log WHERE entity_id=${saved.id} AND action='updated'`;
  expect(audit).toMatchObject({ before, after: { ...saved, reason: null } });
});

it('writes concrete Friday→Saturday shifts and attributable before/after audit', async () => {
  const saved = await setWeek(f);
  expect(staffSchedule.parse(saved)).toEqual(saved);
  expect(saved.shifts[1]).toMatchObject({
    working_date: '2026-10-09',
    ends_at: '2026-10-10T03:00:00.000Z',
  });
  const updated = await setWeek(f, [{ day: 1, start: '09:00', end: '17:00' }], { revision: 1 });
  expect(updated.revision).toBe(2);
  const audit = await f.h
    .owner`SELECT actor_user_id,before,after FROM audit_log WHERE entity_id=${saved.id} ORDER BY at,id`;
  expect(audit).toHaveLength(2);
  expect(audit[1]).toMatchObject({
    actor_user_id: f.userId,
    before: saved,
    after: { ...updated, reason: null },
  });
});
it('allows one of two competing saves against the same revision and rejects the other as named 409', async () => {
  const results = await Promise.allSettled([
    setWeek(f, [], { week: '2026-10-17' }),
    setWeek(f, [], { week: '2026-10-17' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toMatchObject([
    { reason: { code: 'SCHEDULE_REVISION_CONFLICT' } },
  ]);
});
it('requires past reasons and rolls back failed audit with all shift changes', async () => {
  await expect(setWeek(f, testPattern, { week: '2026-09-26' })).rejects.toMatchObject({
    code: 'SCHEDULE_PAST_REASON_REQUIRED',
  });
  const saved = await setWeek(f, testPattern, {
    week: '2026-09-26',
    reason: 'Synthetic past correction',
  });
  await expect(setWeek(f, [], { week: '2026-09-26', revision: 1 })).rejects.toMatchObject({
    code: 'SCHEDULE_PAST_REASON_REQUIRED',
  });
  await f.h.owner`REVOKE INSERT ON audit_log FROM pospay_app`;
  try {
    await expect(
      setWeek(f, [], { week: '2026-09-26', revision: 1, reason: 'Synthetic removal' }),
    ).rejects.toThrow('SCHEDULE_PERSISTENCE_FAILED');
  } finally {
    await f.h.owner`GRANT INSERT ON audit_log TO pospay_app`;
  }
  expect(await f.h.owner`SELECT revision FROM staff_schedules WHERE id=${saved.id}`).toEqual([
    { revision: 1 },
  ]);
  expect(
    await f.h.owner`SELECT id FROM staff_schedule_shifts WHERE schedule_id=${saved.id}`,
  ).toHaveLength(2);
});
it('uses dated branch intervals and contract limits rather than only open attachments', async () => {
  await f.h
    .owner`UPDATE employee_branches SET "to"='2026-10-20' WHERE employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  await setWeek(f, [{ day: 0, start: '14:00', end: '18:00' }], {
    week: '2026-10-17',
    branch: f.secondBranch,
  });
  await expect(
    setWeek(f, [{ day: 3, start: '14:00', end: '18:00' }], {
      week: '2026-10-17',
      branch: f.secondBranch,
      revision: 1,
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_EMPLOYEE_INELIGIBLE' });
  await f.h.owner`UPDATE employees SET contract_end='2026-11-01' WHERE id=${f.employee.id}`;
  await expect(
    setWeek(f, [{ day: 2, start: '09:00', end: '13:00' }], { week: '2026-10-31' }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_EMPLOYEE_INELIGIBLE' });
  await f.h.owner`UPDATE employees SET contract_end=NULL WHERE id=${f.employee.id}`;
});
it('refuses cross-branch and neighboring-week overlaps including concurrent attempts', async () => {
  await setWeek(f, [{ day: 6, start: '22:00', end: '06:00' }], { week: '2026-11-07' });
  await expect(
    setWeek(f, [{ day: 0, start: '05:00', end: '09:00' }], { week: '2026-11-14' }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_SHIFT_OVERLAP' });
  const fresh = await f.useCase.execute({
    ...scheduleActor(f),
    input: {
      primary_branch_id: f.branch,
      name_en: 'Synthetic overlap employee',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
  });
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from") VALUES(${f.company},${scheduleIds.newId()},${f.business},${fresh.id},${f.secondBranch},'2026-01-01')`;
  const attempts = await Promise.allSettled([
    setWeek(f, [{ day: 0, start: '09:00', end: '13:00' }], {
      week: '2026-11-21',
      employee: fresh.id,
    }),
    setWeek(f, [{ day: 0, start: '10:00', end: '14:00' }], {
      week: '2026-11-21',
      branch: f.secondBranch,
      employee: fresh.id,
    }),
  ]);
  // تاريخ الارتباط في الفرع الثاني مقفول للموظف الأول فقط؛ الموظف الجديد مؤهل في الاثنين.
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(attempts.filter((r) => r.status === 'rejected')).toMatchObject([
    { reason: { code: 'SCHEDULE_SHIFT_OVERLAP' } },
  ]);
});
it('database exclusion independently refuses an overlap even with an otherwise valid parent', async () => {
  const saved = await setWeek(f, [{ day: 0, start: '09:00', end: '13:00' }], {
    week: '2026-12-05',
  });
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${f.company},${scheduleIds.newId()},${saved.id},${f.employee.id},'2026-12-05',0,'10:00','12:00','2026-12-05T07:00Z','2026-12-05T09:00Z')`),
    ),
  ).rejects.toThrow();
});
