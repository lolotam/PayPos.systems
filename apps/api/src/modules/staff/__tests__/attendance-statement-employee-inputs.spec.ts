import {
  attendanceMonthlyInputsStatement,
  attendanceStatementScheduledEmployeesStatement,
} from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  attendanceStatementHttpFixture,
  seedDefaultHours,
  type AttendanceStatementHttpFixture,
} from './attendance-statement-http.fixture.ts';
import {
  seedStatementEmployee,
  seedStatementSession,
  seedStatementShift,
} from './attendance-statement-http-seed.fixture.ts';

let f: AttendanceStatementHttpFixture;
beforeAll(async () => {
  f = await attendanceStatementHttpFixture();
  for (const employeeId of [f.employee.id, await seedStatementEmployee(f)]) {
    if (employeeId !== f.employee.id)
      await seedDefaultHours(f, employeeId, [{ day: 2, start: '09:00', end: '17:00' }]);
    await seedStatementSession(f, employeeId, '2026-10-05');
    await seedStatementShift(f, employeeId, {
      workingDate: '2026-10-05',
      start: '09:00',
      end: '17:00',
    });
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function statements(employeeId?: string) {
  const branch = { id: f.branch, timezone: 'Asia/Kuwait' };
  return [
    attendanceMonthlyInputsStatement(
      f.company,
      {
        businessId: f.business,
        branches: [branch],
        ...(employeeId === undefined ? {} : { employeeId }),
      },
      '2026-10-01',
      '2026-10-31',
    ),
    attendanceStatementScheduledEmployeesStatement(
      f.company,
      f.business,
      branch,
      '2026-10-01',
      '2026-10-31',
      employeeId,
    ),
  ];
}

it('filters before aggregation while preserving the renderer full-branch inputs', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    for (const statement of statements()) expect(await tx.execute(statement)).toHaveLength(2);
    for (const statement of statements(f.employee.id)) {
      const rows = await tx.execute(statement);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        employee_id: f.employee.id,
        branches: [expect.objectContaining({ timezone: 'Asia/Kuwait' })],
      });
      const explained = await tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
      const plans = JSON.stringify(explained);
      expect(plans).toContain(f.employee.id);
      const aggregates: number[] = [];
      JSON.parse(plans, (_key, value: unknown) => {
        if (
          value !== null &&
          typeof value === 'object' &&
          'Node Type' in value &&
          value['Node Type'] === 'Aggregate' &&
          'Actual Rows' in value
        )
          aggregates.push(Number(value['Actual Rows']));
        return value;
      });
      expect(aggregates.length).toBeGreaterThan(0);
      expect(aggregates.every((rows) => rows <= 1)).toBe(true);
    }
  });
});
