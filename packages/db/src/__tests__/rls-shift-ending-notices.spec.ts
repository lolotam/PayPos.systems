import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

const { A, B } = TENANT;
const EMPLOYEE_A = '01920000-0000-7000-8000-0000000000d1';
const EMPLOYEE_B = '01920000-0000-7000-8000-0000000000d2';
const SHIFT_START = new Date('2026-10-04T07:00:00.000Z');
const SHIFT_END = new Date('2026-10-04T15:00:00.000Z');
const APP_END = new Date('2026-10-04T16:00:00.000Z');
const SUPPRESSED_END = new Date('2026-10-04T17:00:00.000Z');
const MOVED_END = new Date('2026-10-04T18:00:00.000Z');
const SPAN_END = new Date('2026-10-04T19:00:00.000Z');
const COUNT_END = new Date('2026-10-04T20:00:00.000Z');
const CROSS_TENANT_END = new Date('2026-10-04T21:00:00.000Z');
const FK_BRANCH_END = new Date('2026-10-04T22:00:00.000Z');
const FK_EMPLOYEE_END = new Date('2026-10-04T23:00:00.000Z');
const ONCE_ONLY_END = new Date('2026-10-05T00:00:00.000Z');
const REMIND_DUE = new Date('2026-10-04T14:30:00.000Z');
const DETECTED_AT = new Date('2026-10-04T14:30:00.000Z');

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
    VALUES(${A.company},${EMPLOYEE_A},${A.business},${A.branch},'Laila',${employeeNameMatchKey('Laila')},'staff','2026-01-01',1)`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${B.company},${EMPLOYEE_B},${B.business},${B.branch},'Sami',${employeeNameMatchKey('Sami')},'staff','2026-01-01',1)`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** سطر دفتر «دوامك قرب يخلص» بأعمدة صريحة، عشان كل قيد يتجرب على قيم معروفة. */
interface NoticeRow {
  readonly company?: string;
  readonly business?: string;
  readonly branch?: string;
  readonly employee?: string;
  readonly endsAt?: Date;
  readonly recipientCount?: number;
  readonly suppressedAt?: Date | null;
}

function noticeRow(row: NoticeRow = {}) {
  return owner`INSERT INTO attendance_shift_ending_notices(
      company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,remind_due_at,notified_at,recipient_count,suppressed_at)
    VALUES(${row.company ?? A.company},${ids.newId()},${row.business ?? A.business},${row.branch ?? A.branch},
      ${row.employee ?? EMPLOYEE_A},${SHIFT_START},${row.endsAt ?? SHIFT_END},${REMIND_DUE},${DETECTED_AT},
      ${row.recipientCount ?? 0},${row.suppressedAt ?? null})`;
}

/** يفشل العمل بالخطأ المطلوب: الـ code والاسم بتوع القيد من الـ error أو من سببه. */
async function rejected(work: Promise<unknown>, code: string, constraint?: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  type PgFailure = { code?: string; constraint_name?: string };
  const failure = error as Error & PgFailure & { cause?: PgFailure };
  const source: PgFailure = failure.code ? failure : (failure.cause ?? failure);
  expect(source.code).toBe(code);
  if (constraint !== undefined) expect(source.constraint_name).toBe(constraint);
}

it('the notices table has FORCE RLS', async () => {
  const [flags] = await owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname='attendance_shift_ending_notices'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
});

it('a row of one tenant is invisible to the other tenant and to a connection without a tenant', async () => {
  await noticeRow();
  await db.withTenant(B.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_shift_ending_notices`)).toHaveLength(0);
  });
  await db.withTenant(A.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_shift_ending_notices`)).toHaveLength(1);
  });
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  const auth = postgres(testDb.authUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw.unsafe('SELECT id FROM attendance_shift_ending_notices')).toHaveLength(0);
    await expect(auth.unsafe('SELECT id FROM attendance_shift_ending_notices')).rejects.toThrow();
  } finally {
    await raw.end();
    await auth.end();
  }
});

it('a tenant cannot insert a row carrying another company id and can insert its own', async () => {
  await rejected(
    db.withTenant(B.company, (tx) =>
      tx.execute(sql`INSERT INTO attendance_shift_ending_notices(company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,remind_due_at,notified_at,recipient_count)
        VALUES(${A.company},${ids.newId()},${A.business},${A.branch},${EMPLOYEE_A},${SHIFT_START.toISOString()}::timestamptz,${CROSS_TENANT_END.toISOString()}::timestamptz,${REMIND_DUE.toISOString()}::timestamptz,${DETECTED_AT.toISOString()}::timestamptz,0)`),
    ),
    '42501',
  );
  await db.withTenant(A.company, (tx) =>
    tx.execute(sql`INSERT INTO attendance_shift_ending_notices(company_id,id,business_id,branch_id,employee_id,shift_starts_at,shift_ends_at,remind_due_at,notified_at,recipient_count)
      VALUES(${A.company},${ids.newId()},${A.business},${A.branch},${EMPLOYEE_A},${SHIFT_START.toISOString()}::timestamptz,${APP_END.toISOString()}::timestamptz,${REMIND_DUE.toISOString()}::timestamptz,${DETECTED_AT.toISOString()}::timestamptz,0)`),
  );
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute(
      sql`SELECT id FROM attendance_shift_ending_notices WHERE shift_ends_at = ${APP_END.toISOString()}::timestamptz`,
    ),
  );
  expect(rows).toHaveLength(1);
});

it('the app role cannot update or delete the rows of its own tenant', async () => {
  await rejected(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE attendance_shift_ending_notices SET recipient_count = 1`),
    ),
    '42501',
  );
  await rejected(
    db.withTenant(A.company, (tx) => tx.execute(sql`DELETE FROM attendance_shift_ending_notices`)),
    '42501',
  );
});

it('the tenant-qualified foreign keys refuse a branch or an employee of another tenant', async () => {
  await rejected(
    noticeRow({ branch: B.branch, endsAt: FK_BRANCH_END }),
    '23503',
    'attendance_shift_ending_notices_branch_fk',
  );
  await rejected(
    noticeRow({ employee: EMPLOYEE_B, endsAt: FK_EMPLOYEE_END }),
    '23503',
    'attendance_shift_ending_notices_employee_fk',
  );
});

it('the checks refuse a broken span, a negative recipient count and a suppression with recipients', async () => {
  await rejected(
    noticeRow({ endsAt: SHIFT_START }),
    '23514',
    'attendance_shift_ending_notices_span',
  );
  await rejected(
    noticeRow({ endsAt: SPAN_END, recipientCount: -1 }),
    '23514',
    'attendance_shift_ending_notices_recipients',
  );
  await rejected(
    noticeRow({ endsAt: COUNT_END, recipientCount: 1, suppressedAt: DETECTED_AT }),
    '23514',
    'attendance_shift_ending_notices_suppressed',
  );
});

it('a suppressed row with no recipients is accepted', async () => {
  await noticeRow({ endsAt: SUPPRESSED_END, recipientCount: 0, suppressedAt: DETECTED_AT });
  const [row] =
    await owner`SELECT recipient_count, suppressed_at FROM attendance_shift_ending_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE_A} AND shift_ends_at=${SUPPRESSED_END}`;
  expect(row).toMatchObject({ recipient_count: 0 });
  expect(row?.['suppressed_at']).not.toBeNull();
});

it('the once-only key refuses a second row for the same shift end and allows a moved end', async () => {
  await noticeRow({ endsAt: ONCE_ONLY_END });
  await rejected(
    noticeRow({ endsAt: ONCE_ONLY_END }),
    '23505',
    'attendance_shift_ending_notices_shift_key',
  );
  await noticeRow({ endsAt: MOVED_END });
  const rows = await owner`SELECT shift_ends_at FROM attendance_shift_ending_notices
    WHERE company_id=${A.company} AND employee_id=${EMPLOYEE_A} AND shift_ends_at=${MOVED_END}`;
  expect(rows).toHaveLength(1);
});
