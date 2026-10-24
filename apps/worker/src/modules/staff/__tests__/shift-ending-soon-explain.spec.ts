import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import {
  dueShiftEndsStatement,
  employeeBranchesStatement,
} from '../persistence/shift-ending-soon.transactions.ts';
import { MORNING_IN } from './break-not-returned.fixture.ts';
import { SHIFT_END, SHIFT_START, WEEK, WORKING, type Tenant } from './not-clocked-in.fixture.ts';
import {
  ENDS_SOON_REMIND_AT,
  shiftEndingSoonFixture,
  type ShiftEndingSoonFixture,
} from './shift-ending-soon.fixture.ts';
import { takeTestEmployeeNumbers } from './test-employee-number.ts';

const PAGE_SIZE = 150;
const HISTORY_SIZE = 3000;

let f: ShiftEndingSoonFixture;
beforeAll(async () => {
  f = await shiftEndingSoonFixture();
});
afterAll(async () => {
  await f?.close();
});

it('the candidate row carries the shift facts and the presence as a column', async () => {
  const tenant = await f.tenant();
  const working = await f.employee(tenant, { nameEn: 'Working' });
  const absent = await f.employee(tenant, { nameEn: 'Absent' });
  await f.shift(tenant, working);
  await f.shift(tenant, absent);
  await f.session(tenant, working, { clockIn: MORNING_IN });
  const rows = await f.db.withTenant(tenant.company, (tx) =>
    tx.execute<Record<string, unknown>>(
      dueShiftEndsStatement(tenant.company, ENDS_SOON_REMIND_AT, null, 100),
    ),
  );
  expect(rows).toHaveLength(2);
  expect(Object.keys(rows[0] ?? {})).toEqual([
    'id',
    'employee_id',
    'starts_at',
    'ends_at',
    'business_id',
    'branch_id',
    'has_open_session',
  ]);
  expect(rows.find((row) => row['employee_id'] === working)?.['has_open_session']).toBe(true);
  expect(rows.find((row) => row['employee_id'] === absent)?.['has_open_session']).toBe(false);
  const foreign = await f.tenant();
  expect(
    await f.db.withTenant(foreign.company, (tx) =>
      tx.execute(dueShiftEndsStatement(tenant.company, ENDS_SOON_REMIND_AT, null, 100)),
    ),
  ).toHaveLength(0);
});

it('the branch probe reads the employee and her attachments without a full scan', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  await f.shift(tenant, employee);
  // الجداول صغيرة في شركة جديدة، فالمخطط بيميل للمسح الشامل؛ إجباره على الفهرس بيوضح المسار الصح.
  const nodes = planNodes(
    await plan(tenant.company, employeeBranchesStatement(tenant.company, employee, WORKING), true),
  );
  for (const relation of ['employees', 'employee_branches'])
    expect(
      nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === relation),
    ).toBe(false);
});

it('pages past one hundred running shifts and every probe uses its named index', async () => {
  const tenant = await f.tenant();
  await seedPage(tenant);
  await seedHistory(tenant);
  await f.owner`ANALYZE staff_schedule_shifts, staff_schedules, attendance_sessions, attendance_shift_ending_notices`;
  const due = dueShiftEndsStatement(tenant.company, ENDS_SOON_REMIND_AT, null, 100);
  assertDuePlan(await plan(tenant.company, due));
  const rows = await f.db.withTenant(tenant.company, (tx) =>
    tx.execute<Record<string, unknown>>(due),
  );
  expect(rows).toHaveLength(100);
  const first = rows[0];
  const cursor = { startsAt: SHIFT_START, employeeId: String(first?.['employee_id']) };
  const next = dueShiftEndsStatement(tenant.company, ENDS_SOON_REMIND_AT, cursor, 100);
  assertDuePlan(await plan(tenant.company, next));
  const nextRows = await f.db.withTenant(tenant.company, (tx) =>
    tx.execute<Record<string, unknown>>(next),
  );
  expect(nextRows).toHaveLength(100);
  expect(nextRows[0]?.['employee_id']).not.toBe(first?.['employee_id']);
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: PAGE_SIZE });
  expect(f.endsSoonFailures).toEqual([]);
}, 120_000);

/** الفهرسات المسماة: مسح الفهرس مش مسح شامل، والدفتر والحضور بيتقروا بفهرسهما. */
function assertDuePlan(value: unknown) {
  const nodes = planNodes(value);
  const shifts = nodes.filter(
    (node) => node['Index Name'] === 'staff_schedule_shifts_company_starts_idx',
  );
  expect(shifts).toHaveLength(1);
  expect(shifts[0]?.['Node Type']).toMatch(/Index.*Scan/);
  expect(String(shifts[0]?.['Index Cond'])).toContain('starts_at <=');
  expect(String(shifts[0]?.['Index Cond'])).toContain('starts_at >');
  expect(
    nodes.some((node) => node['Index Name'] === 'attendance_shift_ending_notices_shift_key'),
  ).toBe(true);
  expect(nodes.some((node) => node['Index Name'] === 'attendance_sessions_one_open')).toBe(true);
  for (const relation of [
    'staff_schedule_shifts',
    'attendance_sessions',
    'attendance_shift_ending_notices',
  ])
    expect(
      nodes.some((node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === relation),
    ).toBe(false);
}

async function plan(company: string, statement: SQL, force = false) {
  return f.db.withTenant(company, async (tx) => {
    if (force) await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
  });
}

function planNodes(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(planNodes)];
}

/** مئة وخمسون موظفة بنفس الوردية، وكلهم بصمة مفتوحة: الصفحة بتتجاوز المئة. */
async function seedPage(tenant: Tenant) {
  const { company, business, branch } = tenant;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${company}, gen_random_uuid(), ${business}, ${branch}, 'Synthetic bulk', ${employeeNameMatchKey('Synthetic bulk')}, 'staff', '2026-01-01',
      gs.n + ${takeTestEmployeeNumbers(company, PAGE_SIZE) - 1}
    FROM generate_series(1, ${PAGE_SIZE}) AS gs(n)`;
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${company}, gen_random_uuid(), ${business}, ${branch}, e.id, ${WEEK}, 'Asia/Kuwait', 1
    FROM employees e WHERE e.company_id=${company} AND e.name_en='Synthetic bulk'`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT company_id, gen_random_uuid(), id, employee_id, ${WORKING}, 1, '10:00', '18:00',
      ${SHIFT_START}, ${SHIFT_END}
    FROM staff_schedules WHERE company_id=${company} AND week_start=${WEEK}`;
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,status,source,geo,late_minutes,scheduled_start,scheduled_end)
    SELECT sh.company_id, gen_random_uuid(), ${business}, ${branch}, sh.employee_id, ${WORKING}, 'Asia/Kuwait',
      ${MORNING_IN}, 'OPEN', 'QR', 'OK', 0, sh.starts_at, sh.ends_at
    FROM staff_schedule_shifts sh WHERE sh.company_id=${company}`;
}

/** تاريخ قديم: موظفين وردىهم وحضور مقفول وسجل دفتر كبير، عشان المخطط ما يستخدمش مسح شامل. */
async function seedHistory(tenant: Tenant) {
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, 'Synthetic history', ${employeeNameMatchKey('Synthetic history')}, 'staff', '2026-01-01',
      gs.n + ${takeTestEmployeeNumbers(tenant.company, HISTORY_SIZE) - 1}
    FROM generate_series(1, ${HISTORY_SIZE}) AS gs(n)`;
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, e.id, '2026-08-29', 'Asia/Kuwait', 1
    FROM employees e WHERE e.company_id=${tenant.company} AND e.name_en='Synthetic history'`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT company_id, gen_random_uuid(), id, employee_id, '2026-08-30', 1, '09:00', '17:00',
      '2026-08-30T06:00:00.000Z', '2026-08-30T14:00:00.000Z'
    FROM staff_schedules WHERE company_id=${tenant.company} AND week_start='2026-08-29'`;
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
      clock_in,clock_out,status,closed_by,source,geo,late_minutes)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, e.id,
      d::date, 'Asia/Kuwait', d + interval '7 hours', d + interval '15 hours', 'CLOSED', 'EMPLOYEE', 'QR', 'OK', 0
    FROM employees e CROSS JOIN generate_series('2026-07-01'::timestamptz, '2026-09-30'::timestamptz, interval '1 day') AS d
    WHERE e.company_id=${tenant.company} AND e.name_en='Synthetic bulk'`;
  // سجل الدفتر الكبير: واحد وعشرون صف لكل وردية قديمة (نحو 63 ألف صف)، بمفتاح الموظف ولحظة النهاية.
  // الجملة بتتقسم على ثلاثة: كل جملة نحو 21 ألف صف، عشان ما تعدّيش مهلة الـ statement.
  for (const [from, to] of [
    [0, 6],
    [7, 13],
    [14, 20],
  ] as const) {
    await f.owner`INSERT INTO attendance_shift_ending_notices(company_id,id,business_id,branch_id,employee_id,
        shift_starts_at,shift_ends_at,remind_due_at,notified_at,recipient_count)
      SELECT sh.company_id, gen_random_uuid(), sc.business_id, sc.branch_id, sh.employee_id,
        sh.starts_at + d * interval '1 day', sh.ends_at + d * interval '1 day',
        sh.starts_at + d * interval '1 day', '2026-09-01T00:00:00.000Z', 0
      FROM staff_schedule_shifts sh
      JOIN staff_schedules sc ON sc.company_id = sh.company_id AND sc.id = sh.schedule_id
      CROSS JOIN generate_series(${from}::int, ${to}::int) AS d
      WHERE sh.company_id = ${tenant.company} AND sh.working_date = '2026-08-30'`;
  }
}
