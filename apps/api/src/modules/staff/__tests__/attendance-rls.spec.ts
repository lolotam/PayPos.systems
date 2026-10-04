import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { attendanceFixture, type AttendanceFixture } from './clock-attendance.fixture.ts';

let f: AttendanceFixture;
const tables = [
  'attendance_states',
  'attendance_sessions',
  'attendance_exceptions',
  'attendance_clock_challenges',
] as const;
beforeAll(async () => {
  f = await attendanceFixture();
  await (await f.prepare()).execute();
});
afterAll(async () => {
  await f?.close();
});

it.each(tables)(
  '%s enforces FORCE RLS, hides reads/updates and refuses cross-tenant inserts',
  async (table) => {
    const name = sql.identifier(table);
    const [flags] =
      await f.owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=${table}`;
    expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    await f.database.withTenant(f.otherCompany, async (tx) => {
      expect(await tx.execute(sql`SELECT id FROM ${name}`)).toHaveLength(0);
    });
    if (table !== 'attendance_clock_challenges')
      await f.database.withTenant(f.otherCompany, async (tx) => {
        expect(await tx.execute(sql`UPDATE ${name} SET id=id RETURNING id`)).toHaveLength(0);
      });
    const [row] = await f.owner.unsafe(`SELECT row_to_json(t) AS record FROM ${table} t LIMIT 1`);
    expect(row).toBeDefined();
    await expect(
      f.database.withTenant(f.otherCompany, (tx) =>
        tx.execute(sql`
    INSERT INTO ${name} SELECT (json_populate_record(NULL::${name},${JSON.stringify(row?.record)}::json)).*`),
      ),
    ).rejects.toThrow();
    await expect(
      f.database.withTenant(f.companyId, (tx) =>
        tx.execute(sql`UPDATE ${name} SET company_id=${f.otherCompany}`),
      ),
    ).rejects.toThrow();
    await expect(
      f.database.withTenant(f.companyId, (tx) => tx.execute(sql`DELETE FROM ${name}`)),
    ).rejects.toThrow();
    const raw = postgres(f.test.appUrl, { max: 1, onnotice: () => undefined });
    const auth = postgres(f.test.authUrl, { max: 1, onnotice: () => undefined });
    try {
      expect(await raw.unsafe(`SELECT id FROM ${table}`)).toHaveLength(0);
      await expect(auth.unsafe(`SELECT id FROM ${table}`)).rejects.toThrow();
    } finally {
      await raw.end();
      await auth.end();
    }
  },
);

it('tenant-qualified FKs prevent sessions referencing another tenant employee', async () => {
  await expect(
    f.database.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`
    INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
    VALUES(${f.otherCompany},${f.ids.newId()},${f.businessId},${f.branchId},${f.employeeId},'2026-10-04','Asia/Kuwait',${f.clock.now().toISOString()},'OPEN','BARCODE','NONE',0)`),
    ),
  ).rejects.toThrow();
});

it('partial uniqueness independently forbids a second OPEN session', async () => {
  await expect(
    f.database.withTenant(f.companyId, (tx) =>
      tx.execute(sql`
    INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.branchId},${f.employeeId},'2026-10-04','Asia/Kuwait',${f.clock.now().toISOString()},'OPEN','BARCODE','NONE',0)`),
    ),
  ).rejects.toThrow();
});

it('board and monthly report access paths have usable tenant-leading indexes', async () => {
  await f.database.withTenant(f.companyId, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const board =
      await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM attendance_sessions WHERE company_id=${f.companyId}
      AND business_id=${f.businessId} AND branch_id=${f.branchId} AND working_date='2026-10-04' AND status='OPEN'`);
    expect(JSON.stringify(board)).toMatch(/attendance_sessions_(board_idx|one_open)/);
    const report =
      await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM attendance_sessions WHERE company_id=${f.companyId}
      AND employee_id=${f.employeeId} AND working_date>='2026-10-01' AND working_date<'2026-11-01' ORDER BY working_date,clock_in`);
    expect(JSON.stringify(report)).toContain('attendance_sessions_employee_date_idx');
    const exceptions =
      await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM attendance_exceptions WHERE company_id=${f.companyId}
      AND business_id=${f.businessId} AND branch_id=${f.branchId} AND status='OPEN' ORDER BY raised_at`);
    expect(JSON.stringify(exceptions)).toContain('attendance_exceptions_board_idx');
  });
});

it('an employee created by the application role gets its attendance State from the trigger', async () => {
  const employee = f.ids.newId();
  await f.database.withTenant(
    f.companyId,
    (tx) =>
      tx.execute(sql`
    INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    VALUES(${f.companyId},${employee},${f.businessId},${f.branchId},'Synthetic hire','staff','2026-10-04')`),
    { userId: f.userId },
  );
  expect(
    await f.owner`SELECT company_id,id,business_id,employee_id,last_accepted_scan_at FROM attendance_states
      WHERE employee_id=${employee}`,
  ).toEqual([
    {
      company_id: f.companyId,
      id: employee,
      business_id: f.businessId,
      employee_id: employee,
      last_accepted_scan_at: null,
    },
  ]);
});
