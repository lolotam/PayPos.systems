import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { addScheduleDays } from '../domain/schedule-calendar.ts';
import { scheduleActor, schedulesFixture, type SchedulesFixture } from './schedules.fixture.ts';
let f: SchedulesFixture;
let templateId: string;
const employeeIds: string[] = [];
beforeAll(async () => {
  f = await schedulesFixture();
  employeeIds.push(f.employee.id);
  for (let i = 1; i < 20; i++) {
    const employee = await f.useCase.execute({
      ...scheduleActor(f),
      input: {
        primary_branch_id: f.branch,
        name_en: `Synthetic batch employee ${i}`,
        role_code: 'staff',
        hire_date: '2026-01-01',
      },
    });
    employeeIds.push(employee.id);
  }
  const shifts = Array.from({ length: 7 }, (_, day) => [
    { day, start: '08:00', end: '12:00' },
    { day, start: '14:00', end: '18:00' },
  ]).flat();
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic maximum batch', shifts },
  });
  templateId = template.id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it.each([
  { employees: 20, weeks: 1, start: '2028-01-01' },
  { employees: 2, weeks: 10, start: '2028-04-01' },
])(
  'applies 20 concrete weekly copies atomically: $employees employees × $weeks weeks',
  async (size) => {
    const weeks = Array.from({ length: size.weeks }, (_, i) => addScheduleDays(size.start, i * 7));
    const start = performance.now();
    const result = await f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId,
      input: {
        branch_id: f.branch,
        employee_ids: employeeIds.slice(0, size.employees),
        weeks,
        replace: false,
      },
    });
    const elapsed = performance.now() - start;
    expect(result.schedules).toHaveLength(20);
    const ids = result.schedules.map((s) => s.id);
    expect(
      await f.h.owner`SELECT id FROM staff_schedule_shifts WHERE schedule_id=ANY(${ids}::uuid[])`,
    ).toHaveLength(280);
    expect(
      await f.h
        .owner`SELECT id FROM audit_log WHERE entity_id=ANY(${ids}::uuid[]) AND actor_user_id=${f.userId}`,
    ).toHaveLength(20);
    process.stdout.write(
      JSON.stringify({
        event: 'schedule_apply.bounded_batch',
        employees: size.employees,
        weeks: size.weeks,
        elapsed_ms: Number(elapsed.toFixed(1)),
      }) + '\n',
    );
  },
);
it('refuses the larger selection before any schedule/audit write', async () => {
  const weeks = Array.from({ length: 12 }, (_, i) => addScheduleDays('2029-01-06', i * 7));
  await expect(
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId,
      input: {
        branch_id: f.branch,
        employee_ids: employeeIds,
        weeks,
        replace: false,
      },
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_APPLY_BATCH_TOO_LARGE' });
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start='2029-01-06'`,
  ).toHaveLength(0);
});
