import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  schedulesFixture,
  scheduleActor,
  setWeek,
  testPattern,
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
it('copies templates, edits and archives never change concrete copies, and every write is audited', async () => {
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic weekly pattern', shifts: testPattern },
  });
  const copied = await f.applyTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    input: {
      branch_id: f.branch,
      employee_ids: [f.employee.id],
      weeks: ['2026-10-03', '2026-10-10'],
      replace: false,
    },
  });
  expect(copied.schedules).toHaveLength(2);
  const changed = await f.updateTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    input: { name_en: 'Synthetic changed pattern', shifts: [], expected_revision: 1 },
  });
  expect(changed.revision).toBe(2);
  await expect(
    f.updateTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: { name_en: 'Synthetic stale', shifts: [], expected_revision: 1 },
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_REVISION_CONFLICT' });
  await f.archiveTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    expectedRevision: 2,
  });
  const count = await f.h
    .owner`SELECT id FROM staff_schedule_shifts WHERE schedule_id=${copied.schedules[0]?.id ?? ''}`;
  expect(count).toHaveLength(2);
  await expect(
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: {
        branch_id: f.branch,
        employee_ids: [f.employee.id],
        weeks: ['2026-10-17'],
        replace: false,
      },
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_TEMPLATE_ARCHIVED' });
  expect(
    await f.h.owner`SELECT actor_user_id FROM audit_log WHERE entity_id=${template.id}`,
  ).toEqual(Array.from({ length: 3 }, () => ({ actor_user_id: f.userId })));
});
it('lists all existing target conflicts, requires explicit reason, and replaces independently', async () => {
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic replacement', shifts: [{ day: 0, start: '09:00', end: '17:00' }] },
  });
  const input = {
    branch_id: f.branch,
    employee_ids: [f.employee.id],
    weeks: ['2026-11-07', '2026-11-14'],
    replace: false,
  };
  await setWeek(f, [], { week: '2026-11-07' });
  await setWeek(f, [], { week: '2026-11-14' });
  await expect(
    f.applyTemplate.execute({ ...scheduleActor(f), templateId: template.id, input }),
  ).rejects.toMatchObject({
    code: 'SCHEDULE_APPLY_CONFLICT',
    details: {
      conflicts: input.weeks.map((week_start) => ({
        week_start,
        branch_id: f.branch,
        employee_id: f.employee.id,
      })),
    },
  });
  await expect(
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: { ...input, replace: true },
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_REPLACE_REASON_REQUIRED' });
  const replaced = await f.applyTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    input: { ...input, replace: true, reason: 'Synthetic replacement reason' },
  });
  expect(replaced.schedules.map((s) => s.revision)).toEqual([2, 2]);
});
it('keeps application atomic when any target is invalid and supports 12 chosen weeks', async () => {
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: { name_en: 'Synthetic twelve weeks', shifts: [] },
  });
  const input = {
    branch_id: f.branch,
    employee_ids: [f.employee.id],
    weeks: ['2027-01-02', '2027-01-09'],
    replace: false,
  };
  await expect(
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: { ...input, employee_ids: [f.employee.id, f.otherCompany] },
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start='2027-01-02'`,
  ).toHaveLength(0);
  const weeks = [
    '2027-01-02',
    '2027-01-09',
    '2027-01-16',
    '2027-01-23',
    '2027-01-30',
    '2027-02-06',
    '2027-02-13',
    '2027-02-20',
    '2027-02-27',
    '2027-03-06',
    '2027-03-13',
    '2027-03-20',
  ];
  expect(
    (
      await f.applyTemplate.execute({
        ...scheduleActor(f),
        templateId: template.id,
        input: { ...input, weeks },
      })
    ).schedules,
  ).toHaveLength(12);
  await expect(
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: { ...input, weeks: [...weeks, '2027-03-27'] },
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_WEEK_INVALID' });
});
it('refuses recurring Fri→Sat overlaps between copies with no partial writes', async () => {
  const template = await f.createTemplate.execute({
    ...scheduleActor(f),
    input: {
      name_en: 'Synthetic week overlap',
      shifts: [
        { day: 0, start: '05:00', end: '09:00' },
        { day: 6, start: '22:00', end: '06:00' },
      ],
    },
  });
  await expect(
    f.applyTemplate.execute({
      ...scheduleActor(f),
      templateId: template.id,
      input: {
        branch_id: f.branch,
        employee_ids: [f.employee.id],
        weeks: ['2027-04-03', '2027-04-10'],
        replace: false,
      },
    }),
  ).rejects.toMatchObject({ code: 'SCHEDULE_SHIFT_OVERLAP' });
  expect(
    await f.h.owner`SELECT id FROM staff_schedules WHERE week_start IN ('2027-04-03','2027-04-10')`,
  ).toHaveLength(0);
});
