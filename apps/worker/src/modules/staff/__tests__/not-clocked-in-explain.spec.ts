import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { branchManagerRecipientsStatement } from '../persistence/branch-manager-recipients.adapter.ts';
import {
  approvedLeavesStatement,
  countingClockInsStatement,
  dueShiftsStatement,
  presenceSessionStatement,
} from '../persistence/not-clocked-in.transactions.ts';
import { NOT_CLOCKED_IN_PAGE_SIZE } from '../use-cases/detect-not-clocked-in/detect-not-clocked-in.ts';
import {
  ALERT_AT,
  notClockedInFixture,
  ROLE,
  SHIFT_END,
  SHIFT_START,
  WEEK,
  WORKING,
  type NotClockedInFixture,
} from './not-clocked-in.fixture.ts';

let f: NotClockedInFixture;
beforeAll(async () => {
  f = await notClockedInFixture();
});
afterAll(async () => {
  await f?.close();
});

async function plan(
  company: string,
  statement: ReturnType<typeof dueShiftsStatement>,
  forceIndex = true,
) {
  return f.db.withTenant(company, async (tx) => {
    if (forceIndex) await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
  });
}

it('pages past one hundred due shifts and the probes use the named indexes', async () => {
  const tenant = await f.tenant();
  const employeeId = await seedPage(tenant.company, tenant.business, tenant.branch);
  await seedDecoys(tenant);
  await seedHistory(tenant);
  f.setNow(ALERT_AT);
  expect((await f.detect().execute(tenant.company)).notified).toBe(NOT_CLOCKED_IN_PAGE_SIZE + 1);
  await expectIndexes(tenant, employeeId);
}, 120_000);

async function seedPage(company: string, business: string, branch: string) {
  const count = NOT_CLOCKED_IN_PAGE_SIZE + 1;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${company}, gen_random_uuid(), ${business}, ${branch}, 'Synthetic bulk',${employeeNameMatchKey('Synthetic bulk')}, 'staff', '2026-01-01'
    FROM generate_series(1, ${count})`;
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${company}, gen_random_uuid(), ${business}, ${branch}, e.id, ${WEEK}, 'Asia/Kuwait', 1
    FROM employees e WHERE e.company_id=${company} AND e.name_en='Synthetic bulk'`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT company_id, gen_random_uuid(), id, employee_id, ${WORKING}, 1, '10:00', '18:00',
      ${SHIFT_START} - (ord - 1) * interval '1 second', ${SHIFT_END} - (ord - 1) * interval '1 second'
    FROM (
      SELECT company_id, id, employee_id, row_number() OVER (ORDER BY employee_id) AS ord
      FROM staff_schedules WHERE company_id=${company} AND week_start=${WEEK}
    ) numbered`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT company_id, gen_random_uuid(), id, employee_id, ${WORKING}, 1, '10:00', '18:00',
      ${SHIFT_END} + g.i * interval '2 minutes', ${SHIFT_END} + g.i * interval '2 minutes' + interval '1 minute'
    FROM staff_schedules CROSS JOIN generate_series(1, 20) AS g(i)
    WHERE company_id=${company} AND week_start=${WEEK}`;
  await seedProbes(company);
  const [sample] =
    await f.owner`SELECT id FROM employees WHERE company_id=${company} AND name_en='Synthetic bulk' LIMIT 1`;
  return String(sample?.['id']);
}

async function seedProbes(company: string) {
  const decider = await f.user('decider');
  const early = new Date('2026-10-04T04:00:00.000Z');
  const leaveStart = new Date('2026-10-04T05:00:00.000Z');
  const leaveEnd = new Date('2026-10-04T06:00:00.000Z');
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
    SELECT company_id, gen_random_uuid(), business_id, primary_branch_id, id, '2026-10-04', 'Asia/Kuwait', ${early}, 'OPEN', 'QR', 'OK', 0
    FROM employees WHERE company_id=${company} AND name_en='Synthetic bulk'`;
  await f.owner`UPDATE attendance_sessions SET status='CLOSED', closed_by='EMPLOYEE', clock_out=${leaveStart}
    WHERE company_id=${company}`;
  await f.owner`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",start,"end",timezone,starts_at,ends_at,type,status,requested_by,requested_at,decided_by,decided_at)
    SELECT company_id, gen_random_uuid(), business_id, primary_branch_id, id, 'PARTIAL', ${WORKING}, ${WORKING}, '08:00', '09:00', 'Asia/Kuwait',
      ${leaveStart}, ${leaveEnd}, 'ANNUAL', 'APPROVED', ${decider}, ${leaveStart}, ${decider}, ${leaveStart}
    FROM employees WHERE company_id=${company} AND name_en='Synthetic bulk'`;
}

async function seedDecoys(tenant: { company: string; business: string; branch: string }) {
  await f.member({
    tenant,
    userId: await f.user('bulk'),
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  await f.owner`WITH seeded AS (
    INSERT INTO "user"(id, name, email)
    SELECT gen_random_uuid(), 'Synthetic member', gen_random_uuid()::text || '@example.test'
    FROM generate_series(1, 200) RETURNING id
  )
  INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
  SELECT ${tenant.company}, gen_random_uuid(), seeded.id, ${ROLE.cashier}, 'global', 'COMPANY', ${tenant.company}, '2026-01-01T00:00:00Z'
  FROM seeded`;
}

async function seedHistory(tenant: { company: string; business: string; branch: string }) {
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, 'Synthetic history',${employeeNameMatchKey('Synthetic history')}, 'staff', '2026-01-01'
    FROM generate_series(1, 3000)`;
  await f.owner`INSERT INTO staff_schedules(company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${tenant.company}, gen_random_uuid(), ${tenant.business}, ${tenant.branch}, e.id, '2026-08-29', 'Asia/Kuwait', 1
    FROM employees e WHERE e.company_id=${tenant.company} AND e.name_en='Synthetic history'`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT company_id, gen_random_uuid(), id, employee_id, '2026-08-30', 1, '09:00', '17:00',
      '2026-08-30T06:00:00.000Z', '2026-08-30T14:00:00.000Z'
    FROM staff_schedules WHERE company_id=${tenant.company} AND week_start='2026-08-29'`;
}

async function expectIndexes(
  tenant: { company: string; business: string; branch: string },
  employeeId: string,
) {
  await f.owner`ANALYZE staff_schedule_shifts, attendance_sessions, leave_requests, memberships`;
  const from = new Date('2026-10-04T05:00:00.000Z');
  const due = await plan(
    tenant.company,
    dueShiftsStatement(tenant.company, SHIFT_START, ALERT_AT, null, 100),
    false,
  );
  assertStartRange(due);
  expect(planNodes(due).some((node) => node['Join Type'] === 'Anti')).toBe(true);
  expect(await f.db.withTenant(tenant.company, (tx) =>
    tx.execute(dueShiftsStatement(tenant.company, SHIFT_START, ALERT_AT, null, 100)),
  )).toHaveLength(0);
  const idleAt = new Date('2026-10-06T07:20:00Z');
  const idle = dueShiftsStatement(tenant.company, idleAt, idleAt, null, 100);
  assertStartRange(await plan(tenant.company, idle, false));
  expect(await f.db.withTenant(tenant.company, (tx) => tx.execute(idle))).toHaveLength(0);
  const text = JSON.stringify({
    due,
    presence: await plan(tenant.company, presenceSessionStatement(tenant.company, employeeId, ALERT_AT)),
    clocks: await plan(
      tenant.company,
      countingClockInsStatement(tenant.company, employeeId, from, ALERT_AT),
    ),
    leaves: await plan(
      tenant.company,
      approvedLeavesStatement(tenant.company, employeeId, SHIFT_START, SHIFT_END, WORKING),
    ),
    recipients: await plan(
      tenant.company,
      branchManagerRecipientsStatement(tenant.company, tenant.business, tenant.branch, ALERT_AT, [
        'owner',
        'general_manager',
        'business_manager',
        'branch_manager',
      ]),
    ),
  });
  expect(text).toContain('staff_schedule_shifts_company_starts_idx');
  expect(text).toContain('attendance_sessions_employee_date_idx');
  expect(text).toContain('attendance_sessions_one_open');
  expect(text).toContain('leave_requests_company_employee_period_idx');
  expect(text).toContain('memberships_scope_branch_idx');
  expect(text).toContain('memberships_scope_business_idx');
}

function assertStartRange(plan: unknown) {
  const scans = planNodes(plan).filter(
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
