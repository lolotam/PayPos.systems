import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { scheduleGrid, scheduleWeekResult, templatePage } from '@pospay/contracts';
import {
  branchScheduleStatement,
  branchScheduleWeek,
  employeeScheduleStatement,
  employeeScheduleWeek,
} from '../queries/schedule-week.query.ts';
import { listShiftTemplates, shiftTemplatesStatement } from '../queries/shift-templates.query.ts';
import {
  schedulesFixture,
  scheduleActor,
  setWeek,
  testWeek,
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
it('projects Sat..Fri employee grid including unscheduled rows and cursor pages', async () => {
  await setWeek(f);
  const unscheduled = await f.useCase.execute({
    ...scheduleActor(f),
    input: {
      primary_branch_id: f.branch,
      name_en: 'Synthetic unscheduled',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
  });
  const query = { week_start: testWeek, limit: 1 };
  const first = await f.db.withTenant(f.company, (tx) =>
    branchScheduleWeek(tx, f.company, f.userId, f.business, f.branch, query, f.access),
  );
  const page = scheduleGrid.parse(first);
  expect(page.days).toEqual([
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
  ]);
  expect(page.items[0]?.employee_id).toBe(f.employee.id);
  expect(page.next_cursor).toBe(f.employee.id);
  const second = scheduleGrid.parse(
    await f.db.withTenant(f.company, (tx) =>
      branchScheduleWeek(
        tx,
        f.company,
        f.userId,
        f.business,
        f.branch,
        { ...query, cursor: f.employee.id },
        f.access,
      ),
    ),
  );
  expect(second.items).toEqual([
    { employee_id: unscheduled.id, name_en: unscheduled.name_en, name_ar: null, schedule: null },
  ]);
  expect(second.next_cursor).toBeNull();
});
it('returns only the selected branch week, missing schedule is null and unknown/foreign employees are hidden', async () => {
  const read = (employeeId: string, branch = f.branch) =>
    f.db.withTenant(f.company, (tx) =>
      employeeScheduleWeek(
        tx,
        f.company,
        f.userId,
        f.business,
        branch,
        employeeId,
        testWeek,
        f.access,
      ),
    );
  expect(scheduleWeekResult.parse(await read(f.employee.id)).schedule?.shifts).toHaveLength(2);
  expect(scheduleWeekResult.parse(await read(f.employee.id, f.secondBranch))).toEqual({
    schedule: null,
  });
  expect(await read(f.otherCompany)).toBe('NOT_FOUND');
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      employeeScheduleWeek(
        tx,
        f.otherCompany,
        f.userId,
        f.business,
        f.branch,
        f.employee.id,
        testWeek,
        f.access,
      ),
    ),
  ).toBe('NOT_FOUND');
});
it('lists template contract shapes including archives with an id cursor', async () => {
  const created = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic query pattern', shifts: [] },
  });
  const archived = await f.archiveTemplate.execute({
    ...scheduleActor(f),
    templateId: created.id,
    expectedRevision: 1,
  });
  const page = await f.db.withTenant(f.company, (tx) =>
    listShiftTemplates(tx, f.company, f.userId, f.business, { limit: 20 }, f.access),
  );
  expect(templatePage.parse(page)).toEqual({ items: [archived], next_cursor: null });
});
it('EXPLAIN ANALYZE verifies indexes for actual grid, employee-week and template statements', async () => {
  const plans = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return Promise.all([
      tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${branchScheduleStatement(f.company, f.business, f.branch, { week_start: testWeek, limit: 20 })}`,
      ),
      tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${employeeScheduleStatement(f.company, f.business, f.branch, f.employee.id, testWeek)}`,
      ),
      tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${shiftTemplatesStatement(f.company, f.business, { limit: 20 })}`,
      ),
    ]);
  });
  expect(JSON.stringify(plans[0])).toMatch(/employees_company_business_id_(idx|key)/);
  expect(JSON.stringify(plans[0])).toMatch(/staff_schedules_(branch_week_idx|week_key)/);
  expect(JSON.stringify(plans[1])).toMatch(/staff_schedules_(branch_week_idx|week_key)/);
  expect(JSON.stringify(plans[1])).toContain('staff_schedule_shifts_schedule_idx');
  expect(JSON.stringify(plans[2])).toContain('staff_shift_templates_business_idx');
});
