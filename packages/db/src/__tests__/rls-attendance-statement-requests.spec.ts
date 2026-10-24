import { employeeNameMatchKey } from '@pospay/domain';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';

const { A, B } = TENANT;
const EMPLOYEE_A = '01920000-0000-7000-8000-0000000000e1';
const EMPLOYEE_B = '01920000-0000-7000-8000-0000000000e2';
const OTHER_BUSINESS = '01920000-0000-7000-8000-0000000000e3';
const OTHER_BRANCH = '01920000-0000-7000-8000-0000000000e4';
const OTHER_EMPLOYEE = '01920000-0000-7000-8000-0000000000e5';
const REQUESTED_AT = new Date('2026-10-23T08:00:00.000Z');

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en)
    VALUES(${A.company},${OTHER_BUSINESS},'salon','Second business of company A')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${A.company},${OTHER_BRANCH},${OTHER_BUSINESS},'Branch of the second business')`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${A.company},${EMPLOYEE_A},${A.business},${A.branch},'Laila',${employeeNameMatchKey('Laila')},'staff','2026-01-01',1)`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${B.company},${EMPLOYEE_B},${B.business},${B.branch},'Sami',${employeeNameMatchKey('Sami')},'staff','2026-01-01',1)`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${A.company},${OTHER_EMPLOYEE},${OTHER_BUSINESS},${OTHER_BRANCH},'Nadia',${employeeNameMatchKey('Nadia')},'staff','2026-01-01',2)`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** سطر طلب بيان بأعمدة صريحة، عشان كل قيد يتجرب على قيم معروفة. */
interface RequestRow {
  readonly id?: string;
  readonly company?: string;
  readonly business?: string;
  readonly branch?: string;
  readonly form?: string;
  readonly employee?: string | null;
  readonly from?: string;
  readonly to?: string;
  readonly language?: string;
  readonly shiftStart?: string | null;
  readonly shiftEnd?: string | null;
  readonly logoFileId?: string | null;
}

function requestRow(row: RequestRow = {}) {
  return owner`INSERT INTO attendance_statement_requests(
      company_id,id,business_id,branch_id,form,employee_id,period_from,period_to,language,shift_start,shift_end,logo_file_id,requested_by,requested_at)
    VALUES(${row.company ?? A.company},${row.id ?? ids.newId()},${row.business ?? A.business},${row.branch ?? A.branch},
      ${row.form ?? 'BRANCH'},${row.employee ?? null},${row.from ?? '2026-10-01'},${row.to ?? '2026-10-31'},
      ${row.language ?? 'ar'},${row.shiftStart ?? null},${row.shiftEnd ?? null},${row.logoFileId ?? null},
      ${'01920000-0000-7000-8000-0000000000f1'},${REQUESTED_AT.toISOString()}::timestamptz)`;
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

it('the request table has FORCE RLS', async () => {
  const [flags] = await owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname='attendance_statement_requests'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
});

it('a row of one tenant is invisible to the other tenant and to a connection without a tenant', async () => {
  await requestRow();
  await requestRow({ company: B.company, business: B.business, branch: B.branch });
  await db.withTenant(B.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_statement_requests`)).toHaveLength(1);
  });
  await db.withTenant(A.company, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_statement_requests`)).toHaveLength(1);
  });
  const raw = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  const auth = postgres(testDb.authUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await raw.unsafe('SELECT id FROM attendance_statement_requests')).toHaveLength(0);
    await expect(auth.unsafe('SELECT id FROM attendance_statement_requests')).rejects.toThrow();
  } finally {
    await raw.end();
    await auth.end();
  }
});

it('a tenant cannot insert a row carrying another company id and can insert its own', async () => {
  await rejected(
    db.withTenant(A.company, (tx) =>
      tx.execute(sql`INSERT INTO attendance_statement_requests(company_id,id,business_id,branch_id,form,period_from,period_to,language,requested_by,requested_at)
        VALUES(${B.company},${ids.newId()},${B.business},${B.branch},'BRANCH','2026-10-01'::date,'2026-10-31'::date,'ar',
          ${'01920000-0000-7000-8000-0000000000f1'},${REQUESTED_AT.toISOString()}::timestamptz)`),
    ),
    '42501',
  );
  await db.withTenant(A.company, (tx) =>
    tx.execute(sql`INSERT INTO attendance_statement_requests(company_id,id,business_id,branch_id,form,period_from,period_to,language,requested_by,requested_at)
      VALUES(${A.company},${ids.newId()},${A.business},${A.branch},'BRANCH','2026-10-01'::date,'2026-10-31'::date,'ar',
        ${'01920000-0000-7000-8000-0000000000f1'},${REQUESTED_AT.toISOString()}::timestamptz)`),
  );
  const rows = await db.withTenant(A.company, (tx) =>
    tx.execute(sql`SELECT id FROM attendance_statement_requests WHERE language='ar'`),
  );
  expect(rows.length).toBeGreaterThanOrEqual(1);
});

it('the app role cannot update or delete the rows of its own tenant', async () => {
  await rejected(
    db.withTenant(A.company, (tx) => tx.execute(sql`UPDATE attendance_statement_requests SET language='en'`)),
    '42501',
  );
  await rejected(
    db.withTenant(A.company, (tx) => tx.execute(sql`DELETE FROM attendance_statement_requests`)),
    '42501',
  );
});

it('the tenant-qualified foreign keys refuse a branch or an employee of another business', async () => {
  await rejected(
    requestRow({ branch: OTHER_BRANCH }),
    '23503',
    'attendance_statement_requests_branch_fk',
  );
  await rejected(
    requestRow({ employee: OTHER_EMPLOYEE }),
    '23503',
    'attendance_statement_requests_employee_fk',
  );
});

it('the checks refuse a bad form, a bad language and a broken period', async () => {
  await rejected(requestRow({ form: 'ALL' }), '23514', 'attendance_statement_requests_form');
  await rejected(requestRow({ language: 'fr' }), '23514', 'attendance_statement_requests_language');
  await rejected(
    requestRow({ from: '2026-10-20', to: '2026-10-01' }),
    '23514',
    'attendance_statement_requests_period',
  );
  await rejected(
    requestRow({ from: '2026-01-01', to: '2027-01-02' }),
    '23514',
    'attendance_statement_requests_period',
  );
});

it('the checks refuse an employee form without an employee and a shift on it', async () => {
  await rejected(
    requestRow({ form: 'EMPLOYEE', employee: null }),
    '23514',
    'attendance_statement_requests_employee',
  );
  await rejected(
    requestRow({ form: 'EMPLOYEE', employee: EMPLOYEE_A, shiftStart: '09:00', shiftEnd: '20:00' }),
    '23514',
    'attendance_statement_requests_shift',
  );
});

it('the checks refuse half a shift pair and accept a full one', async () => {
  await rejected(
    requestRow({ shiftStart: '09:00', shiftEnd: null }),
    '23514',
    'attendance_statement_requests_shift',
  );
  await requestRow({ shiftStart: '09:00', shiftEnd: '20:00' });
});

it('a period of 366 days is accepted and the same id under two companies is allowed', async () => {
  await requestRow({ from: '2026-01-01', to: '2027-01-01' });
  const shared = ids.newId();
  await requestRow({ id: shared });
  await requestRow({ id: shared, company: B.company, business: B.business, branch: B.branch });
  const rows = await owner`SELECT company_id FROM attendance_statement_requests WHERE id=${shared}`;
  expect(rows).toHaveLength(2);
});
