import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';
import {
  clampStaffMonthsBack,
  StaffMonthsBackRoleRefusedError,
} from '../data-steps/staff-months-back.ts';

const { A, B } = TENANT;
type Tx = Parameters<Parameters<Database['withTenant']>[1]>[0];
// ملفات ترحيل الخطوة: من src/__tests__ لحد migrations/.
const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', 'migrations');
const RANGE_MIGRATION = '0169_2026-10-22_staff-months-back-range.sql';
const VALIDATE_MIGRATION = '0170_2026-10-22_staff-months-back-validate.sql';

let testDb: TestDatabase, owner: postgres.Sql, app: Database;
// الـ fixture بياخد نشاط واحد بس لكل شركة، والصفوف دي محتاجة أنشطة مستقلة عشان كل صف ليه قيمة مختلفة.
let extraA1: string, extraA2: string, extraB1: string, extraB2: string;
// القيد كما تركته الـ migrations، قبل ما الاختبار ينزله ويبنيه تاني.
let liveConstraint: { definition: string; validated: boolean } | undefined;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  // قبل أي DROP في الـ beforeEach: دي الحالة اللي وصلتنا من الـ migrations.
  liveConstraint = await readLiveConstraint();
  app = createDatabase({ url: testDb.appUrl, ids: systemUuidV7(), maxConnections: 1 });
  extraA1 = await createBusiness(A.company, 'Synthetic A1');
  extraA2 = await createBusiness(A.company, 'Synthetic A2');
  extraB1 = await createBusiness(B.company, 'Synthetic B1');
  extraB2 = await createBusiness(B.company, 'Synthetic B2');
});

beforeEach(async () => {
  // الـ CHECK بينزل قبل البذر: التضييق الجديد (1..12) بيرفض القيم اللي فوقه، والصفوف دي أقدم من التضييق.
  await owner`ALTER TABLE business_settings DROP CONSTRAINT IF EXISTS business_settings_staff_months_back`;
  await owner`DELETE FROM business_settings`;
  await insertSetting(A.company, A.business, 24);
  await insertSetting(A.company, extraA1, 12);
  await insertSetting(A.company, extraA2, 1);
  await insertSetting(B.company, B.business, 13);
  await insertSetting(B.company, extraB1, 5);
  await insertSetting(B.company, extraB2, null);
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

async function createBusiness(companyId: string, nameEn: string): Promise<string> {
  const id = systemUuidV7().newId();
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES (${id}, ${companyId}, 'salon', ${nameEn})`;
  return id;
}

async function insertSetting(
  companyId: string,
  businessId: string,
  monthsBack: number | null,
): Promise<void> {
  await owner`INSERT INTO business_settings (company_id, business_id, staff_months_back)
    VALUES (${companyId}, ${businessId}, ${monthsBack})`;
}

async function restoreMonthsBackContract(): Promise<void> {
  await owner`ALTER TABLE business_settings DROP CONSTRAINT IF EXISTS business_settings_staff_months_back`;
  await owner`ALTER TABLE business_settings ADD CONSTRAINT business_settings_staff_months_back
    CHECK (staff_months_back IS NULL OR staff_months_back BETWEEN 1 AND 12) NOT VALID`;
  await owner`ALTER TABLE business_settings VALIDATE CONSTRAINT business_settings_staff_months_back`;
}

/**
 * القيد كما هو في الداتابيز دلوقتي: نصّه وهل اتحقّق. لازم يتقرأ قبل أي DROP عشان يبقى ده نص الـ migrations.
 */
async function readLiveConstraint(): Promise<{ definition: string; validated: boolean }> {
  const [row] = await owner<{ definition: string; validated: boolean }[]>`
    SELECT pg_get_constraintdef(c.oid) AS definition, c.convalidated AS validated
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE c.conname = 'business_settings_staff_months_back' AND t.relname = 'business_settings'`;
  if (row === undefined) throw new Error('The migrations left no staff months back constraint');
  return row;
}

interface SettingRow {
  readonly business_id: string;
  readonly staff_months_back: number | null;
  readonly updated_at: Date;
  readonly updated_by: string | null;
}

async function allSettings(): Promise<SettingRow[]> {
  return owner<SettingRow[]>`SELECT business_id, staff_months_back, updated_at, updated_by
    FROM business_settings ORDER BY company_id, business_id`;
}

async function settingsOf(companyId: string) {
  return owner<{ business_id: string; staff_months_back: number | null }[]>`
    SELECT business_id, staff_months_back FROM business_settings
    WHERE company_id = ${companyId} ORDER BY business_id`;
}

it('MY-Q9 values above 12 become 12 in every company and nothing else changes', async () => {
  const before = await allSettings();
  expect(await clampStaffMonthsBack(owner, app)).toEqual({ companies: 2, clamped: 2 });
  const after = await allSettings();
  const expected = new Map<string, number | null>([
    [A.business, 12],
    [extraA1, 12],
    [extraA2, 1],
    [B.business, 12],
    [extraB1, 5],
    [extraB2, null],
  ]);
  expect(after).toHaveLength(before.length);
  for (const row of after) expect(row.staff_months_back).toBe(expected.get(row.business_id));
  // تصحيح بيانات مش تعديل مدير: وقت التعديل ومين عدّله ما يتلمسوش.
  expect(after.map((row) => row.updated_at)).toEqual(before.map((row) => row.updated_at));
  expect(after.every((row) => row.updated_by === null)).toBe(true);
});

it('a second run clamps nothing and the narrowed CHECK then validates', async () => {
  expect(await clampStaffMonthsBack(owner, app)).toEqual({ companies: 2, clamped: 2 });
  expect(await clampStaffMonthsBack(owner, app)).toEqual({ companies: 2, clamped: 0 });
  await expect(restoreMonthsBackContract()).resolves.toBeUndefined();
  await expect(
    owner`UPDATE business_settings SET staff_months_back = 13
      WHERE company_id = ${A.company} AND business_id = ${A.business}`,
  ).rejects.toThrow(/business_settings_staff_months_back/);
  await expect(
    owner`UPDATE business_settings SET staff_months_back = 12
      WHERE company_id = ${A.company} AND business_id = ${A.business}`,
  ).resolves.toBeDefined();
});

it("the step writes under withTenant: a company's rows are reached only through its own tenant context", async () => {
  const [flags] =
    await owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'business_settings'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  const asA = <T>(work: (tx: Tx) => Promise<T>) => app.withTenant(A.company, work);
  expect(
    await asA((tx) =>
      tx.execute(sql`SELECT business_id FROM business_settings WHERE company_id = ${B.company}`),
    ),
  ).toHaveLength(0);
  expect(
    await asA((tx) =>
      tx.execute(sql`UPDATE business_settings SET staff_months_back = 3
        WHERE company_id = ${B.company} RETURNING business_id`),
    ),
  ).toHaveLength(0);
  expect(await clampStaffMonthsBack(owner, app)).toEqual({ companies: 2, clamped: 2 });
  const a = await settingsOf(A.company);
  const b = await settingsOf(B.company);
  expect(a.find((row) => row.business_id === A.business)?.staff_months_back).toBe(12);
  expect(b.find((row) => row.business_id === B.business)?.staff_months_back).toBe(12);
});

it('a migration role without superuser or BYPASSRLS is refused before any read', async () => {
  const plain = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(clampStaffMonthsBack(plain, app)).rejects.toBeInstanceOf(
      StaffMonthsBackRoleRefusedError,
    );
  } finally {
    await plain.end();
  }
  const rows = await settingsOf(A.company);
  expect(rows.find((row) => row.business_id === A.business)?.staff_months_back).toBe(24);
});

it('migrations 0169 and 0170 leave the CHECK narrowed to 1-12 and validated', () => {
  if (liveConstraint === undefined) throw new Error('The live constraint was never read');
  // Postgres بيطبع المدى يا BETWEEN يا مقارنتين، والاتنين معناها 1..12.
  const flat = liveConstraint.definition.replace(/[()]/g, ' ').replace(/\s+/g, ' ');
  expect(flat).toMatch(/BETWEEN 1 AND 12|>= 1 AND .*<= 12/);
  expect(liveConstraint.definition).not.toContain('24');
  expect(liveConstraint.validated).toBe(true);
});

it('both migration files carry the data-step marker the runner looks for', () => {
  const range = readFileSync(join(MIGRATIONS_FOLDER, RANGE_MIGRATION), 'utf8');
  const validate = readFileSync(join(MIGRATIONS_FOLDER, VALIDATE_MIGRATION), 'utf8');
  expect(range.split(/\r?\n/)[0]).toBe('-- pospay:data-step staff-months-back');
  expect(validate.split(/\r?\n/)[0]).toBe('-- pospay:data-step staff-months-back');
  expect(range).toContain('BETWEEN 1 AND 12');
  expect(range).toContain('NOT VALID');
  expect(validate).toContain('VALIDATE CONSTRAINT "business_settings_staff_months_back"');
});
