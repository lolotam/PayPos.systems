import {
  attendanceMonthlyInputsStatement,
  attendanceStatementEmployeeCoverageStatement,
  attendanceStatementScheduledEmployeesStatement,
} from '@pospay/db';
import { hasAttendanceStatementCoverage, mergeAttendanceStatementRows, type ReportBranchInputs } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createAttendanceStatementEmployeesReader } from '../persistence/attendance-statement-employees.read.ts';
import { attendanceStatementHttpFixture, type AttendanceStatementHttpFixture } from './attendance-statement-http.fixture.ts';
import { takeTestEmployeeNumbers } from '../../../../test/test-employee-number.ts';

const FROM = '2025-10-31';
const TO = '2026-10-31';
const EMPLOYEES = 60;
const NOW = '2026-10-23T07:00:00.000Z';

let f: AttendanceStatementHttpFixture;
const scope = () => ({ companyId: f.company, userId: f.userId, businessId: f.business, branchId: f.branch });

/** ٦٠ موظفة × ٣٦٦ يوم: دوام افتراضي ووردية مجدولة وجلسة مقفولة لكل يوم، بنفس شكل حمل الباحث الشهري. */
async function seedYear() {
  const first = takeTestEmployeeNumbers(f.company, EMPLOYEES);
  await f.h.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${f.company},gen_random_uuid(),${f.business},${f.branch},'Synthetic year employee '||n,'synthetic year employee '||n,'staff','2025-01-01'::date,${first}::int+n
    FROM generate_series(0,${EMPLOYEES - 1}) AS n`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    SELECT company_id,gen_random_uuid(),business_id,id,primary_branch_id,'2025-01-01'::date
    FROM employees WHERE company_id=${f.company} AND name_en LIKE 'Synthetic year employee %'`;
  await f.h.owner`INSERT INTO employee_default_shifts(company_id,business_id,employee_id,branch_id,day,start,"end",updated_by,updated_at)
    SELECT e.company_id,e.business_id,e.id,e.primary_branch_id,d,'09:00'::time,'17:00'::time,${f.userId},now()
    FROM employees e CROSS JOIN generate_series(0,6) AS d
    WHERE e.company_id=${f.company} AND e.name_en LIKE 'Synthetic year employee %'`;
  await f.h.owner`CREATE TEMP TABLE year_days AS
    SELECT e.id AS employee_id, e.primary_branch_id AS branch_id, d::date AS date,
      ((extract(dow FROM d)::int + 1) % 7) AS weekday,
      (d::date - ((extract(dow FROM d)::int + 1) % 7))::date AS week_start
    FROM employees e CROSS JOIN generate_series(${FROM}::date,${TO}::date,'1 day') AS d
    WHERE e.company_id=${f.company} AND e.name_en LIKE 'Synthetic year employee %'`;
  await f.h.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${f.company},gen_random_uuid(),${f.business},branch_id,employee_id,week_start,'Asia/Kuwait',1
    FROM year_days GROUP BY branch_id,employee_id,week_start`;
  await f.h.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",
      starts_at,ends_at,break_start,break_end,break_starts_at,break_ends_at)
    SELECT ${f.company},gen_random_uuid(),s.id,y.employee_id,y.date,y.weekday,'09:00','17:00',
      (y.date::text||'T06:00:00Z')::timestamptz,(y.date::text||'T14:00:00Z')::timestamptz,null,null,null,null
    FROM year_days y JOIN staff_schedules s ON s.company_id=${f.company} AND s.employee_id=y.employee_id AND s.week_start=y.week_start`;
  await f.h.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,source,closed_by,geo,late_minutes,scheduled_end)
    SELECT ${f.company},gen_random_uuid(),${f.business},branch_id,employee_id,date,'Asia/Kuwait',
      (date::text||'T06:00:00Z')::timestamptz,(date::text||'T14:00:00Z')::timestamptz,'CLOSED','QR','EMPLOYEE','NONE',0,
      (date::text||'T14:00:00Z')::timestamptz
    FROM year_days`;
  await f.h.owner`DROP TABLE year_days`;
  // قاعدة الاختبار المستنسخة كانت فارغة؛ VACUUM بيثبّت حالة الصفوف المكتوبة والإحصاءات بتصف حمل السنة قبل قياس الخطة.
  await f.h.owner`VACUUM (ANALYZE) employees,employee_branches,employee_default_shifts,staff_schedules,staff_schedule_shifts,attendance_sessions`;
}

beforeAll(async () => {
  f = await attendanceStatementHttpFixture();
  await seedYear();
}, 120_000);
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('lists 60 employees over the 366-day maximum period well under the 200 ms budget', async () => {
  const read = createAttendanceStatementEmployeesReader(f.db, { now: () => new Date(NOW) });
  const samples: number[] = [];
  for (let index = 0; index < 7; index++) {
    const start = performance.now();
    const result = await read(scope(), { from: FROM, to: TO });
    const elapsed = performance.now() - start;
    expect(result.employees.length).toBeGreaterThanOrEqual(EMPLOYEES);
    if (index >= 2) samples.push(elapsed);
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.info('attendance_statement_employees_366d', { median_ms: Number(median.toFixed(2)), max_ms: Number(Math.max(...samples).toFixed(2)) });
  // الوسيط مش الأقصى: عيّنة واحدة بطيئة على جهاز CI مشغول مش معناها إن المسار تقيل.
  expect(median).toBeLessThan(200);
});

it('plans the coverage statement on existing tenant indexes with no sequential scan of the year', async () => {
  const branch = { id: f.branch, timezone: 'Asia/Kuwait' };
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const result = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceStatementEmployeeCoverageStatement(f.company, f.business, branch, FROM, TO)}`,
    );
    return JSON.stringify(result);
  });
  expect(plan).toMatch(/attendance_sessions_(board|business_date|employee_date)_idx/);
  expect(plan).toMatch(/staff_schedule/);
  expect(Number(plan.match(/"Execution Time":([\d.]+)/)?.[1])).toBeLessThan(200);
});

it('lists the same employees as the full input pipeline over the 366-day period', async () => {
  const read = createAttendanceStatementEmployeesReader(f.db, { now: () => new Date(NOW) });
  const light = (await read(scope(), { from: FROM, to: TO })).employees.map((e) => e.employee_id);
  const branch = { id: f.branch, timezone: 'Asia/Kuwait' };
  const full = await f.db.withTenant(f.company, async (tx) => {
    type Row = { employee_id: string; employee_number: number; branches: ReportBranchInputs[] };
    const report = await tx.execute<Row>(
      attendanceMonthlyInputsStatement(f.company, { businessId: f.business, branches: [branch] }, FROM, TO),
    );
    const scheduled = await tx.execute<Row>(
      attendanceStatementScheduledEmployeesStatement(f.company, f.business, branch, FROM, TO),
    );
    return mergeAttendanceStatementRows(report, scheduled)
      .filter((row) => row.branches.some((entry) => hasAttendanceStatementCoverage(entry, { from: FROM, to: TO }, NOW, null)))
      .map((row) => row.employee_id);
  });
  expect(light.toSorted()).toEqual(full.toSorted());
});
