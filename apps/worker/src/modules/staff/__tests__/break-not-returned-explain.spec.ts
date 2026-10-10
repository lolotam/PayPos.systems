import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  breakOutStatement,
  dueBreaksStatement,
  returnedStatement,
} from '../persistence/break-not-returned.transactions.ts';
import { BREAK_NOT_RETURNED_PAGE_SIZE } from '../use-cases/detect-break-not-returned/detect-break-not-returned.ts';
import { SHIFT_END, SHIFT_START, WEEK, WORKING } from './not-clocked-in.fixture.ts';
import {
  BREAK_ALERT_AT,
  BREAK_END,
  BREAK_OUT,
  BREAK_START,
  MORNING_IN,
  breakNotReturnedFixture,
  type BreakNotReturnedFixture,
} from './break-not-returned.fixture.ts';

let f: BreakNotReturnedFixture;
beforeAll(async () => {
  f = await breakNotReturnedFixture();
});
afterAll(async () => {
  await f?.close();
});

type Tenant = { company: string; business: string; branch: string };

it('pages past one hundred due breaks and every probe uses its named index', async () => {
  const tenant = await f.tenant();
  await seedPage(tenant);
  await seedHistory(tenant);
  await f.owner`ANALYZE staff_schedule_shifts, attendance_sessions`;
  const dueNow = dueBreaksStatement(tenant.company, BREAK_END, BREAK_ALERT_AT, null, 100);
  const due = await plan(tenant.company, dueNow, false);
  assertStartRange(due);
  assertAttendanceProbe(due);
  expect(await f.db.withTenant(tenant.company, (tx) => tx.execute(dueNow))).toHaveLength(100);
  const shift = await lockedSample(tenant);
  assertAttendanceProbe(await plan(tenant.company, breakOutStatement(tenant.company, shift), false));
  assertAttendanceProbe(
    await plan(tenant.company, returnedStatement(tenant.company, shift, BREAK_OUT, BREAK_ALERT_AT), false),
  );
  f.setNow(BREAK_ALERT_AT);
  expect((await f.detectBreak().execute(tenant.company)).notified).toBe(
    BREAK_NOT_RETURNED_PAGE_SIZE + 1,
  );
  expect(f.breakFailures).toEqual([]);
  const idleAt = new Date('2026-10-06T11:10:00Z');
  assertStartRange(await plan(tenant.company, dueBreaksStatement(tenant.company, idleAt, idleAt, null, 100), false));
}, 120_000);

// كل probe على الجلسات لوحده: فهرس الموظف ويوم العمل بحد يوم العمل، مش مسح للتاريخ كله.
function assertAttendanceProbe(value: unknown) {
  const scans = planNodes(value).filter(
    (node) => node['Index Name'] === 'attendance_sessions_employee_date_idx',
  );
  expect(scans.length).toBeGreaterThan(0);
  expect(String(scans[0]?.['Index Cond'])).toContain('working_date >=');
  expect(String(scans[0]?.['Index Cond'])).toContain('working_date <=');
  expect(planNodes(value).some((node) =>
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'attendance_sessions')).toBe(false);
}

async function plan(company: string, statement: ReturnType<typeof dueBreaksStatement>, force = true) {
  return f.db.withTenant(company, async (tx) => {
    if (force) await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
  });
}

async function seedPage(tenant: Tenant) {
  const { company, business, branch } = tenant;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${company}, gen_random_uuid(), ${business}, ${branch}, 'Synthetic bulk', ${employeeNameMatchKey('Synthetic bulk')}, 'staff', '2026-01-01'
    FROM generate_series(1, ${BREAK_NOT_RETURNED_PAGE_SIZE + 1})`;
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${company}, gen_random_uuid(), ${business}, ${branch}, e.id, ${WEEK}, 'Asia/Kuwait', 1
    FROM employees e WHERE e.company_id=${company} AND e.name_en='Synthetic bulk'`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at,
      break_start,break_end,break_starts_at,break_ends_at)
    SELECT company_id, gen_random_uuid(), id, employee_id, ${WORKING}, 1, '10:00', '18:00',
      ${SHIFT_START} - (ord - 1) * interval '1 second', ${SHIFT_END} - (ord - 1) * interval '1 second',
      '13:00', '14:00', ${BREAK_START}, ${BREAK_END}
    FROM (
      SELECT company_id, id, employee_id, row_number() OVER (ORDER BY employee_id) AS ord
      FROM staff_schedules WHERE company_id=${company} AND week_start=${WEEK}
    ) numbered`;
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,closed_by,source,geo,late_minutes,scheduled_start,scheduled_end)
    SELECT sh.company_id, gen_random_uuid(), ${business}, ${branch}, sh.employee_id, ${WORKING}, 'Asia/Kuwait',
      ${MORNING_IN}, ${BREAK_OUT}, 'CLOSED', 'EMPLOYEE', 'QR', 'OK', 0, sh.starts_at, sh.ends_at
    FROM staff_schedule_shifts sh WHERE sh.company_id=${company}`;
}

async function seedHistory(tenant: Tenant) {
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, 'Synthetic history', ${employeeNameMatchKey('Synthetic history')}, 'staff', '2026-01-01'
    FROM generate_series(1, 3000)`;
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, e.id, '2026-08-29', 'Asia/Kuwait', 1
    FROM employees e WHERE e.company_id=${tenant.company} AND e.name_en='Synthetic history'`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at,
      break_start,break_end,break_starts_at,break_ends_at)
    SELECT company_id, gen_random_uuid(), id, employee_id, '2026-08-30', 1, '09:00', '17:00',
      '2026-08-30T06:00:00.000Z', '2026-08-30T14:00:00.000Z', '13:00', '14:00',
      '2026-08-30T10:00:00.000Z', '2026-08-30T11:00:00.000Z'
    FROM staff_schedules WHERE company_id=${tenant.company} AND week_start='2026-08-29'`;
  // تاريخ حضور قديم للموظفين الحاليين كمان، عشان probe الموظف لازم يقطعه بيوم العمل.
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,closed_by,source,geo,late_minutes)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, e.id,
      d::date, 'Asia/Kuwait', d + interval '7 hours', d + interval '15 hours', 'CLOSED', 'EMPLOYEE', 'QR', 'OK', 0
    FROM employees e CROSS JOIN generate_series('2026-07-01'::timestamptz, '2026-09-30'::timestamptz, interval '1 day') AS d
    WHERE e.company_id=${tenant.company} AND e.name_en='Synthetic bulk'`;
}

async function lockedSample(tenant: Tenant) {
  const [row] = await f.owner`SELECT id, employee_id, working_date, starts_at, ends_at FROM staff_schedule_shifts
    WHERE company_id=${tenant.company} AND working_date=${WORKING} LIMIT 1`;
  return {
    id: String(row?.['id']),
    employeeId: String(row?.['employee_id']),
    workingDate: WORKING,
    startsAt: new Date(row?.['starts_at'] as string),
    endsAt: new Date(row?.['ends_at'] as string),
    breakStartsAt: BREAK_START,
    breakEndsAt: BREAK_END,
    businessId: tenant.business,
    branchId: tenant.branch,
    deleted: false,
    contractEnd: null,
    employeeUserId: null,
    nameAr: null,
    nameEn: 'Synthetic bulk',
    branchNameAr: null,
    branchNameEn: 'Salmiya',
    timeZone: 'Asia/Kuwait',
  };
}

function assertStartRange(value: unknown) {
  const scans = planNodes(value).filter(
    (node) => node['Index Name'] === 'staff_schedule_shifts_company_starts_idx',
  );
  expect(scans).toHaveLength(1);
  expect(scans[0]?.['Node Type']).toMatch(/Index.*Scan/);
  expect(scans[0]?.['Index Cond']).toContain('starts_at >');
  expect(scans[0]?.['Index Cond']).toContain('starts_at <=');
  expect(Number(scans[0]?.['Rows Removed by Filter'] ?? 0)).toBeLessThan(100);
}

function planNodes(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(planNodes)];
}
