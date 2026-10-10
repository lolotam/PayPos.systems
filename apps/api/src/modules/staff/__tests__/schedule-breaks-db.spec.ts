import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  schedulesFixture,
  scheduleIds,
  setWeek,
  type SchedulesFixture,
} from './schedules.fixture.ts';

let f: SchedulesFixture;
let scheduleId: string;
beforeAll(async () => {
  f = await schedulesFixture();
  scheduleId = (await setWeek(f, [])).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function insert(values: readonly (string | null)[]) {
  return f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`
    INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at,
      break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.company},${scheduleIds.newId()},${scheduleId},${f.employee.id},'2026-10-03',0,'09:00','17:00',
      '2026-10-03T06:00Z','2026-10-03T14:00Z',${values[0]},${values[1]},${values[2]},${values[3]})`),
  );
}
const valid = ['13:00', '14:00', '2026-10-03T10:00Z', '2026-10-03T11:00Z'];
it.each([0, 1, 2, 3])('BW-06 rejects missing break column %s', async (missing) => {
  await expect(
    insert(valid.map((value, index) => (index === missing ? null : value))),
  ).rejects.toMatchObject({
    cause: { code: '23514', constraint_name: 'staff_schedule_shifts_break_pair' },
  });
});
it('BW-06 rejects only break_start set', async () => {
  await expect(insert(['13:00', null, null, null])).rejects.toMatchObject({
    cause: { code: '23514', constraint_name: 'staff_schedule_shifts_break_pair' },
  });
});
it.each([
  ['05:00', '07:00'],
  ['06:00', '07:00'],
  ['13:00', '14:00'],
  ['13:30', '14:30'],
  ['10:00', '10:00'],
  ['11:00', '10:00'],
])('BW-06 rejects non-interior instants %s–%s', async (start, end) => {
  await expect(
    insert(['13:00', '14:00', `2026-10-03T${start}Z`, `2026-10-03T${end}Z`]),
  ).rejects.toMatchObject({
    cause: { code: '23514', constraint_name: 'staff_schedule_shifts_break_inside' },
  });
});
it('accepts complete and null breaks and validates both constraints', async () => {
  await insert(valid);
  await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`DELETE FROM staff_schedule_shifts WHERE schedule_id=${scheduleId}`),
  );
  await insert([null, null, null, null]);
  expect(
    await f.h.owner`SELECT conname,convalidated FROM pg_constraint WHERE conname IN
    ('staff_schedule_shifts_break_pair','staff_schedule_shifts_break_inside') ORDER BY conname`,
  ).toEqual([
    { conname: 'staff_schedule_shifts_break_inside', convalidated: true },
    { conname: 'staff_schedule_shifts_break_pair', convalidated: true },
  ]);
});
