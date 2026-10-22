import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

const { A, B } = TENANT;
const EMPLOYEE = '01920000-0000-7000-8000-0000000000c1';
const SHIFT_END = new Date('2026-10-04T15:00:00.000Z');
const BREAK_START = new Date('2026-10-04T10:00:00.000Z');
const BREAK_END = new Date('2026-10-04T11:00:00.000Z');
/** كل سطر بداية مختلفة، فمفتاح الدفتر (الموظف وبداية الوردية) ما يتكررش. */
const start = (minutes: number) =>
  new Date(new Date('2026-10-04T07:00:00.000Z').getTime() + minutes * 60_000);

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${A.company},${EMPLOYEE},${A.business},${A.branch},'Laila',${employeeNameMatchKey('Laila')},'staff','2026-01-01',1)`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** سطر دفتر عدم الحضور بعلامة الكبح وعدد المستلمين. */
function notClockedInRow(suppressedAt: Date | null, recipientCount: number, startsAt: Date) {
  return owner`INSERT INTO attendance_not_clocked_in_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,alert_due_at,notified_at,recipient_count,suppressed_at)
    VALUES(${A.company},${ids.newId()},${A.business},${A.branch},${EMPLOYEE},${startsAt},${SHIFT_END},
      ${SHIFT_END},${SHIFT_END},${recipientCount},${suppressedAt})`;
}

/** سطر دفتر البريك بعلامة الكبح وعدد المستلمين. */
function breakRow(suppressedAt: Date | null, recipientCount: number, startsAt: Date) {
  return owner`INSERT INTO attendance_break_not_returned_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,break_ends_at,break_out_at,
      alert_due_at,notified_at,recipient_count,suppressed_at)
    VALUES(${A.company},${ids.newId()},${A.business},${A.branch},${EMPLOYEE},${startsAt},${SHIFT_END},
      ${BREAK_END},${BREAK_START},${SHIFT_END},${SHIFT_END},${recipientCount},${suppressedAt})`;
}

async function refused(work: Promise<unknown>, constraint: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as { code?: string }).code).toBe('23514');
  expect((error as { constraint_name?: string }).constraint_name).toBe(constraint);
}

it('refuses a suppressed not-clocked-in row that claims recipients', async () => {
  await refused(
    notClockedInRow(SHIFT_END, 1, start(0)),
    'attendance_not_clocked_in_notices_suppressed',
  );
});

it('accepts a suppressed not-clocked-in row with no recipients', async () => {
  await notClockedInRow(SHIFT_END, 0, start(1));
  const [row] =
    await owner`SELECT recipient_count, suppressed_at FROM attendance_not_clocked_in_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE} AND shift_starts_at=${start(1)}`;
  expect(row).toMatchObject({ recipient_count: 0 });
  expect(row?.['suppressed_at']).not.toBeNull();
});

it('accepts a not-clocked-in row with recipients and no suppression', async () => {
  await notClockedInRow(null, 2, start(2));
  const [row] =
    await owner`SELECT recipient_count, suppressed_at FROM attendance_not_clocked_in_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE} AND shift_starts_at=${start(2)}`;
  expect(row).toMatchObject({ recipient_count: 2 });
  expect(row?.['suppressed_at']).toBeNull();
});

it('refuses a suppressed break row that claims recipients', async () => {
  await refused(
    breakRow(SHIFT_END, 1, start(0)),
    'attendance_break_not_returned_notices_suppressed',
  );
});

it('accepts a suppressed break row with no recipients', async () => {
  await breakRow(SHIFT_END, 0, start(1));
  const [row] =
    await owner`SELECT recipient_count, suppressed_at FROM attendance_break_not_returned_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE} AND shift_starts_at=${start(1)}`;
  expect(row).toMatchObject({ recipient_count: 0 });
  expect(row?.['suppressed_at']).not.toBeNull();
});

// القيد بيتضاف NOT VALID في 0169 عشان ما تفحصش الدفتر تحت قفل تقيل، والتحقق في 0170؛ لازم يبقى متحققاً.
it('both suppression constraints end validated', async () => {
  const rows = await owner`SELECT conname, convalidated FROM pg_catalog.pg_constraint
    WHERE conname IN ('attendance_not_clocked_in_notices_suppressed','attendance_break_not_returned_notices_suppressed')
    ORDER BY conname`;
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => [row['conname'], row['convalidated']])).toEqual([
    ['attendance_break_not_returned_notices_suppressed', true],
    ['attendance_not_clocked_in_notices_suppressed', true],
  ]);
});

/** تحويل السطر المكبوح لإشعار، زي ما الوظيفة بتعمله. */
const convert = (company: string, startsAt: Date) =>
  db.withTenant(company, (tx) =>
    tx.execute(sql`UPDATE attendance_break_not_returned_notices
      SET suppressed_at = NULL, recipient_count = 2, alert_due_at = ${SHIFT_END.toISOString()}, notified_at = ${SHIFT_END.toISOString()}
      WHERE company_id = ${A.company} AND employee_id = ${EMPLOYEE} AND shift_starts_at = ${startsAt.toISOString()}
      RETURNING id`),
  );

it('converts a suppressed break row into a notified one', async () => {
  await breakRow(SHIFT_END, 0, start(5));
  expect(await convert(A.company, start(5))).toHaveLength(1);
  const [row] = await owner`SELECT recipient_count, suppressed_at, alert_due_at, notified_at
    FROM attendance_break_not_returned_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE} AND shift_starts_at=${start(5)}`;
  expect(row).toMatchObject({ recipient_count: 2 });
  expect(row?.['suppressed_at']).toBeNull();
});

it('leaves an already notified break row alone', async () => {
  await breakRow(null, 2, start(6));
  expect(await convert(A.company, start(6))).toHaveLength(0);
  const [row] = await owner`SELECT recipient_count FROM attendance_break_not_returned_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE} AND shift_starts_at=${start(6)}`;
  expect(row).toMatchObject({ recipient_count: 2 });
});

it('refuses to update a suppressed break row while it stays suppressed', async () => {
  await breakRow(SHIFT_END, 0, start(7));
  await expect(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE attendance_break_not_returned_notices SET recipient_count = 0
        WHERE company_id = ${A.company} AND employee_id = ${EMPLOYEE} AND shift_starts_at = ${start(7).toISOString()}
        RETURNING id`),
    ),
  ).rejects.toThrow();
});

it('refuses to update a break column the app may not change', async () => {
  await breakRow(SHIFT_END, 0, start(8));
  await expect(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE attendance_break_not_returned_notices SET branch_id = ${B.branch}
        WHERE company_id = ${A.company} AND employee_id = ${EMPLOYEE} AND shift_starts_at = ${start(8).toISOString()}`),
    ),
  ).rejects.toThrow();
});

it('does not let another tenant convert a suppressed break row', async () => {
  await breakRow(SHIFT_END, 0, start(9));
  expect(await convert(B.company, start(9))).toHaveLength(0);
  const [row] = await owner`SELECT suppressed_at FROM attendance_break_not_returned_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE} AND shift_starts_at=${start(9)}`;
  expect(row?.['suppressed_at']).not.toBeNull();
});
