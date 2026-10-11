import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceMonthlyReport } from '@pospay/contracts';
import { monthlyReportFixture, reportHeaders, reportSession, reportUrl, type MonthlyReportFixture } from './attendance-monthly-report.fixture.ts';
import { salaryIds } from './salary.fixture.ts';

let f: MonthlyReportFixture;
beforeAll(async () => { f = await monthlyReportFixture(); });
afterAll(async () => { await f?.db.close(); await f?.h.close(); });

async function seedOvernight(date: string, nextDate: string) {
  const schedule = salaryIds.newId(), at = (day: string, time: string) => `${day}T${time}:00+03:00`;
  const scheduledEnd = at(nextDate, '04:00');
  await f.h.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    VALUES(${f.company},${schedule},${f.business},${f.branch},${f.employee.id},${date},'Asia/Kuwait',1)`;
  await f.h.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",
    starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    VALUES(${f.company},${salaryIds.newId()},${schedule},${f.employee.id},${date},0,'20:00','04:00',
      ${at(date,'20:00')},${scheduledEnd},'00:00','01:00',${at(nextDate,'00:00')},${at(nextDate,'01:00')})`;
  await reportSession(f, { date, clockIn: at(date,'20:00'), clockOut: at(nextDate,'00:30'), scheduledEnd });
  await reportSession(f, { date: nextDate, clockIn: at(nextDate,'01:00'), clockOut: scheduledEnd, scheduledEnd });
}

async function get(month: string) {
  const response = await f.h.app.inject({ method: 'GET', url: reportUrl(f).replace('2026-10', month), headers: reportHeaders(f) });
  expect(response.statusCode).toBe(200);
  return attendanceMonthlyReport.parse(response.json()).rows[0];
}

it('credits the October 3 overnight break across the two working dates', async () => {
  await seedOvernight('2026-10-03','2026-10-04');
  expect(await get('2026-10')).toMatchObject({ worked_minutes: 480, scheduled_minutes: 480, days_present: 2 });
});

it('loads adjacent-month sessions and shifts: October gets 300 minutes, November gets 180', async () => {
  await seedOvernight('2026-10-31','2026-11-01');
  expect(await get('2026-10')).toMatchObject({ worked_minutes: 780, scheduled_minutes: 960, days_present: 3 });
  expect(await get('2026-11')).toMatchObject({ worked_minutes: 180, scheduled_minutes: 0, days_present: 1 });
});
