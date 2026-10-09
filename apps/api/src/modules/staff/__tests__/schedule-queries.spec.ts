import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { scheduleGrid, scheduleSettings, scheduleWeekResult, templatePage } from '@pospay/contracts';
import { scheduleSettingsStatement } from '../queries/schedule-settings.query.ts';
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
  expect(page.max_shifts_per_day).toBe(3);
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
  expect(templatePage.parse(page)).toEqual({ items: [archived], next_cursor: null, max_shifts_per_day: 3 });
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
      tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${scheduleSettingsStatement(f.company, f.business)}`),
    ]);
  });
  expect(JSON.stringify(plans[0])).toMatch(/employees_company_business_id_(idx|key)/);
  expect(JSON.stringify(plans[0])).toMatch(/staff_schedules_(branch_week_idx|week_key)/);
  expect(JSON.stringify(plans[1])).toMatch(/staff_schedules_(branch_week_idx|week_key)/);
  expect(JSON.stringify(plans[1])).toContain('staff_schedule_shifts_schedule_idx');
  expect(JSON.stringify(plans[2])).toContain('staff_shift_templates_business_idx');
  for (const plan of [plans[0], plans[2], plans[3]])
    expect(JSON.stringify(plan)).toContain('staff_schedule_settings_pkey');
});
it('projects the default and saved setting, including empty grid and template pages', async () => {
  const read = () => f.db.withTenant(f.company, async tx => {
    const [settings] = await tx.execute(scheduleSettingsStatement(f.company, f.secondBusiness));
    const grid = await tx.execute(branchScheduleStatement(f.company, f.secondBusiness, f.branch, { week_start: testWeek, limit: 20 }));
    const templates = await listShiftTemplates(tx, f.company, f.userId, f.business, { limit: 20 }, f.access);
    return { settings: scheduleSettings.parse(settings), grid: grid[0], templates: templatePage.parse(templates) };
  });
  expect((await read()).settings).toEqual({ business_id: f.secondBusiness, max_shifts_per_day: 3, is_default: true, updated_at: null });
  await f.h.owner`INSERT INTO staff_schedule_settings(company_id,business_id,max_shifts_per_day,updated_by,updated_at) VALUES(${f.company},${f.business},4,${f.userId},'2026-10-10T00:00:00Z'),(${f.company},${f.secondBusiness},4,${f.userId},'2026-10-10T00:00:00Z')`;
  const saved = await read();
  expect(saved.settings).toEqual({ business_id: f.secondBusiness, max_shifts_per_day: 4, is_default: false, updated_at: '2026-10-10T00:00:00.000Z' });
  expect(saved.grid).toMatchObject({ max_shifts_per_day: 4, items: [] });
  expect(saved.templates.max_shifts_per_day).toBe(4);
  const empty = await f.db.withTenant(f.company, tx => tx.execute(shiftTemplatesStatement(f.company, f.secondBusiness, { limit: 20 })));
  expect(empty[0]).toMatchObject({ max_shifts_per_day: 4, items: [] });
});
