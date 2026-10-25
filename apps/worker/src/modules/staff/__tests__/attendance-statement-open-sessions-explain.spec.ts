import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { attendanceStatementOpenSessionsStatement } from '../queries/attendance-statement-open-sessions.query.ts';
import {
  attendanceStatementFixture,
  type AttendanceStatementFixture,
} from './attendance-statement.fixture.ts';

let f: AttendanceStatementFixture;
beforeAll(async () => {
  f = await attendanceStatementFixture();
});
afterAll(async () => {
  await f?.close();
});

const WORKING = '2026-10-01';
const WORKING_TWO = '2026-10-02';
const CLOCK_IN = new Date('2026-10-01T06:00:00.000Z');
const OPEN_IN = new Date('2026-10-02T06:00:00.000Z');
const CLOCK_OUT = new Date('2026-10-01T14:00:00.000Z');

it('the statement returns the open sessions of the employee in the period only', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Sara' });
  await f.session(tenant, employee, {
    workingDate: WORKING,
    clockIn: CLOCK_IN,
    clockOut: CLOCK_OUT,
  });
  await f.session(tenant, employee, { workingDate: WORKING_TWO, clockIn: OPEN_IN });
  const rows = await f.db.withTenant(tenant.company, (tx) =>
    tx.execute(
      attendanceStatementOpenSessionsStatement(
        tenant.company,
        tenant.branch,
        employee,
        '2026-10-01',
        '2026-10-03',
      ),
    ),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ working_date: WORKING_TWO });
  expect(new Date(String(rows[0]?.['clock_in'])).toISOString()).toBe(OPEN_IN.toISOString());
});

it('EXPLAIN ANALYZE reads the open sessions through their index', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Rania' });
  await f.session(tenant, employee, { workingDate: WORKING_TWO, clockIn: OPEN_IN });
  const plans = await f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${attendanceStatementOpenSessionsStatement(
        tenant.company,
        tenant.branch,
        employee,
        '2026-10-01',
        '2026-10-03',
      )}`,
    );
  });
  const nodes = planNodes(plans);
  const scans = nodes.filter((node) => node['Relation Name'] === 'attendance_sessions');
  expect(scans.length).toBeGreaterThan(0);
  expect(scans.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false);
  expect(
    nodes.some((node) => String(node['Index Name'] ?? '').startsWith('attendance_sessions_')),
  ).toBe(true);
});

/** عقد الخطة: كل عقدة فيها نوعها والفهرس اللي استخدمته. */
function planNodes(value: unknown): Record<string, unknown>[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(planNodes);
  const node = value as Record<string, unknown>;
  return [node, ...Object.values(node).flatMap(planNodes)];
}
