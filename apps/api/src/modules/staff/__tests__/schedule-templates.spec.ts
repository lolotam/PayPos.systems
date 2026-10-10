import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { staffSchedule, shiftTemplate, templatePage } from '@pospay/contracts';
import type { ScheduleRecord } from '../domain/schedule-types.ts';
import { scheduleRecord } from '../persistence/schedule-records.ts';
import {
  schedulesFixture,
  scheduleActor,
  setWeek,
  testPattern,
  breakPattern,
  nullBreak,
  scheduleIds,
  type SchedulesFixture,
} from './schedules.fixture.ts';
let f: SchedulesFixture;
beforeAll(async () => {
  f = await schedulesFixture();
});

it('BW-04 copies six breaks to two employees and two weeks and isolates each copy from template edits', async () => {
  const other = await f.useCase.execute({
    ...scheduleActor(f),
    input: {
      primary_branch_id: f.branch,
      name_en: 'Synthetic Heba',
      role_code: 'staff',
      hire_date: '2026-01-01',
    },
  });
  const headers = { cookie: f.cookie, 'x-company-id': f.company };
  const url = `/v1/businesses/${f.business}/shift-templates`;
  const shifts = Array.from({ length: 6 }, (_, day) => ({ ...breakPattern[0], day }));
  const created = await f.h.app.inject({
    method: 'POST',
    url,
    headers,
    payload: { name_en: 'Synthetic morning', name_ar: 'دوام الصبح', shifts },
  });
  expect(created.statusCode).toBe(201);
  const template = shiftTemplate.parse(created.json());
  const applied = await f.applyTemplate.execute({
    ...scheduleActor(f),
    templateId: template.id,
    input: {
      branch_id: f.branch,
      employee_ids: [f.employee.id, other.id],
      weeks: ['2027-06-05', '2027-06-12'],
      replace: false,
    },
  });
  expectCopiedBreaks(applied.schedules);
  const changed = await setWeek(
    f,
    shifts.map((s) => (s.day === 2 ? { ...s, break_start: '14:00', break_end: '15:00' } : s)),
    { week: '2027-06-05', revision: 1 },
  );
  expect(changed.shifts[2]?.break_start).toBe('14:00');
  const listed = await f.h.app.inject({ method: 'GET', url, headers });
  expect(templatePage.parse(listed.json()).items.find((s) => s.id === template.id)?.shifts).toEqual(
    shifts,
  );
  const patched = await f.h.app.inject({
    method: 'PATCH',
    url: `${url}/${template.id}`,
    headers,
    payload: {
      name_en: template.name_en,
      shifts: shifts.map((s) => ({ ...s, break_start: '12:00', break_end: '13:00' })),
      expected_revision: 1,
    },
  });
  expect(patched.statusCode).toBe(200);
  for (const copy of applied.schedules) {
    const read = await f.db.withTenant(f.company, (tx) =>
      scheduleRecord(tx, f.company, f.business, f.branch, copy.employee_id, copy.week_start),
    );
    expect(read?.shifts).toEqual(copy.id === changed.id ? changed.shifts : copy.shifts);
  }
});

it('BW-05 reads, edits and applies pre-break JSONB templates as null breaks', async () => {
  const id = scheduleIds.newId();
  const legacy = [{ day: 0, start: '09:00', end: '17:00' }];
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`INSERT INTO staff_shift_templates(company_id,id,business_id,name_en,shifts,revision)
    VALUES(${f.company},${id},${f.business},'Synthetic legacy',${JSON.stringify(legacy)}::jsonb,1)`),
  );
  const list = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/shift-templates`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
  });
  const shifts = [{ day: 0, start: '09:00', end: '17:00', break_start: null, break_end: null }];
  expect(templatePage.parse(list.json()).items.find((s) => s.id === id)?.shifts).toEqual(shifts);
  const copy = await f.applyTemplate.execute({
    ...scheduleActor(f),
    templateId: id,
    input: {
      branch_id: f.branch,
      employee_ids: [f.employee.id],
      weeks: ['2027-07-03'],
      replace: false,
    },
  });
  expect(copy.schedules[0]?.shifts[0]).toMatchObject(nullBreak);
  const edited = await f.updateTemplate.execute({
    ...scheduleActor(f),
    templateId: id,
    input: { name_en: 'Synthetic legacy edited', shifts: legacy, expected_revision: 1 },
  });
  expect(edited.shifts).toEqual(shifts);
  const [stored] = await f.h.owner`SELECT shifts FROM staff_shift_templates WHERE id=${id}`;
  expect(stored?.shifts).toEqual(shifts);
});

it('BW-05 reads and resaves rows inserted without break columns', async () => {
  const week = '2027-07-10';
  const header = await setWeek(f, [], { week });
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`INSERT INTO staff_schedule_shifts
    (company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${f.company},${scheduleIds.newId()},${header.id},${f.employee.id},${week},0,'09:00','17:00',
      '2027-07-10T06:00Z','2027-07-10T14:00Z')`),
  );
  const read = staffSchedule.parse(
    await f.db.withTenant(f.company, (tx) =>
      scheduleRecord(tx, f.company, f.business, f.branch, f.employee.id, week),
    ),
  );
  expect(read.shifts[0]).toMatchObject(nullBreak);
  const edited = await setWeek(
    f,
    read.shifts.map(({ day, start, end, break_start, break_end }) => ({
      day,
      start,
      end,
      break_start,
      break_end,
    })),
    { week, revision: 1 },
  );
  expect(edited.shifts).toEqual(read.shifts);
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

function expectCopiedBreaks(copies: ScheduleRecord[]) {
  expect(copies).toHaveLength(4);
  for (const copy of copies) {
    expect(copy.shifts).toHaveLength(6);
    for (const shift of copy.shifts)
      expect(shift).toMatchObject({
        break_start: '13:00',
        break_end: '14:00',
        break_starts_at: `${shift.working_date}T10:00:00.000Z`,
        break_ends_at: `${shift.working_date}T11:00:00.000Z`,
      });
  }
}

it('BW-04 refuses a template with an invalid break over HTTP', async () => {
  const url = `/v1/businesses/${f.business}/shift-templates`;
  const headers = { cookie: f.cookie, 'x-company-id': f.company };
  const invalid = await f.h.app.inject({
    method: 'POST',
    url,
    headers,
    payload: {
      name_en: 'Synthetic invalid break',
      shifts: [{ ...breakPattern[0], break_end: '18:00' }],
    },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toMatchObject({
    code: 'SCHEDULE_BREAK_INVALID',
    details: { day: 0, start: '09:00' },
  });
});
