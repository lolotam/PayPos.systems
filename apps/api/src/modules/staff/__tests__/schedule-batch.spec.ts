import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { addScheduleDays } from '../domain/schedule-calendar.ts';
import {
  scheduleActor,
  schedulesFixture,
  scheduleIds,
  type SchedulesFixture,
} from './schedules.fixture.ts';
let f: SchedulesFixture;
let templateId: string;
const employeeIds: string[] = [];
beforeAll(async () => {
  f = await schedulesFixture();
  await f.h
    .owner`INSERT INTO staff_schedule_settings(company_id,business_id,max_shifts_per_day,updated_by,updated_at) VALUES(${f.company},${f.business},4,${f.userId},now())`;
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
    { day, start: '00:00', end: '04:00' },
    { day, start: '06:00', end: '10:00' },
    { day, start: '12:00', end: '16:00' },
    { day, start: '18:00', end: '22:00' },
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

// MS-Q6 (المالك، 10 أكتوبر): 20 نسخة × 28 وردية ممكن تعدّي 200 ms؛ السقف يفضل 20 والتسريع في issue #145.
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
    ).toHaveLength(560);
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
it('returns the same named 422 over HTTP for employee-count and combined limits, preserving 12 weeks', async () => {
  const extra = await f.useCase.execute({
    ...scheduleActor(f),
    input: {
      primary_branch_id: f.branch,
      name_en: 'Synthetic twenty-first employee',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
  });
  const url = `/v1/businesses/${f.business}/shift-templates/${templateId}/apply`;
  const send = (employee_ids: string[], weeks: string[]) =>
    f.h.app.inject({
      method: 'POST',
      url,
      headers: { cookie: f.cookie, 'x-company-id': f.company },
      payload: { branch_id: f.branch, employee_ids, weeks },
    });
  const employeeLimit = await send([...employeeIds, extra.id], ['2030-01-05']);
  const combinedLimit = await send(
    employeeIds.slice(0, 2),
    Array.from({ length: 11 }, (_, i) => addScheduleDays('2030-01-05', i * 7)),
  );
  expect(employeeLimit.statusCode).toBe(422);
  expect(combinedLimit.statusCode).toBe(422);
  expect(employeeLimit.json()).toMatchObject({ code: 'SCHEDULE_APPLY_BATCH_TOO_LARGE' });
  expect(employeeLimit.json()).toEqual(combinedLimit.json());
  expect(
    (
      await send(
        [scheduleIds.newId()],
        Array.from({ length: 13 }, (_, i) => addScheduleDays('2030-01-05', i * 7)),
      )
    ).statusCode,
  ).toBe(400);
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start >= '2030-01-05'`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM audit_log WHERE entity='staff_schedule' AND "after"->>'week_start' >= '2030-01-05'`,
  ).toHaveLength(0);
});
