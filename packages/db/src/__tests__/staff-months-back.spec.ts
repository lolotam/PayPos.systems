import { readFileSync } from 'node:fs';

import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../client.ts';
import { REVIEWED_DATA_STEPS } from '../data-steps/index.ts';
import {
  clampStaffMonthsBack,
  StaffMonthsBackRoleRefusedError,
} from '../data-steps/staff-months-back.ts';

// تضييق مدى «كم شهر لورا» على 1..12 (issue #519): خطوة بيانات ADR-0038 بتقصّر الصفوف القديمة على 12
// جوه withTenant، وبعدها القيد الجديد بيتضاف NOT VALID وبيتعمل له VALIDATE.

const ids = systemUuidV7();
const { A, B } = TENANT;
const CONSTRAINT = 'business_settings_staff_months_back';
const MARKER = '-- pospay:data-step staff-months-back';
const CHECK_NARROW =
  'CHECK ("business_settings"."staff_months_back" IS NULL OR "business_settings"."staff_months_back" BETWEEN 1 AND 12)';
const CHECK_LEGACY =
  'CHECK ("business_settings"."staff_months_back" IS NULL OR "business_settings"."staff_months_back" BETWEEN 1 AND 24)';
const MIGRATIONS = new URL('../../migrations/', import.meta.url);
const CHECK_TAGS = {
  check: '0264_2026-11-26_staff-months-back-check',
  validate: '0265_2026-11-26_staff-months-back-validate',
} as const;

let testDb: TestDatabase, owner: postgres.Sql, app: Database;

/** بيقسّم ملف ترحيل لجمله بالطريقة نفسها اللي drizzle-kit بيقرأ بيها الملف. */
function parseMigrationStatements(text: string): string[] {
  return text
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

const migrationText = (tag: string): string =>
  readFileSync(new URL(`${tag}.sql`, MIGRATIONS), 'utf8');

const dropConstraint = () =>
  owner.unsafe(`ALTER TABLE business_settings DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
const addConstraint = (check: string, notValid: boolean) =>
  owner.unsafe(
    `ALTER TABLE business_settings ADD CONSTRAINT ${CONSTRAINT} ${check}${notValid ? ' NOT VALID' : ''}`,
  );
const validateConstraint = () =>
  owner.unsafe(`ALTER TABLE business_settings VALIDATE CONSTRAINT ${CONSTRAINT}`);

/** بيرجّع القيد المضيّق بالشكل اللي الـ migration عملته: تقصير أي قيمة فوق 12 الأول، ثم NOT VALID وبعدها VALIDATE. */
async function restoreNarrowConstraint(): Promise<void> {
  await dropConstraint();
  await owner`UPDATE business_settings SET staff_months_back = 12 WHERE staff_months_back > 12`;
  await addConstraint(CHECK_NARROW, true);
  await validateConstraint();
}

const constraintRow = () =>
  owner<{ convalidated: boolean; definition: string }[]>`
    SELECT convalidated, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conname = ${CONSTRAINT} AND conrelid = 'business_settings'::regclass`;

const businessFor = async (companyId: string, name: string): Promise<string> => {
  const businessId = ids.newId();
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES (${businessId}, ${companyId}, 'salon', ${name})`;
  return businessId;
};

const insertSettings = async (
  companyId: string,
  businessId: string,
  months: number | null,
  columns: string[] | null,
) => {
  await owner`INSERT INTO business_settings (company_id, business_id, staff_months_back, staff_columns)
    VALUES (${companyId}, ${businessId}, ${months}, ${columns === null ? null : owner.array(columns)}::text[])`;
};

type SettingsRow = {
  business_id: string;
  staff_months_back: number | null;
  staff_columns: string[] | null;
};

const settingsOf = (companyId: string) =>
  owner<SettingsRow[]>`
    SELECT business_id, staff_months_back, staff_columns FROM business_settings
    WHERE company_id = ${companyId} ORDER BY business_id`;

const monthsOf = async (companyId: string) =>
  Object.fromEntries(
    (await settingsOf(companyId)).map((row) => [row.business_id, row.staff_months_back]),
  );

const columnsOf = async (companyId: string) =>
  Object.fromEntries(
    (await settingsOf(companyId)).map((row) => [row.business_id, row.staff_columns]),
  );

const insertAsApp = (businessId: string, months: number | null) =>
  app.withTenant(A.company, (tx) =>
    tx.execute(sql`INSERT INTO business_settings (company_id, business_id, staff_months_back)
      VALUES (${A.company}, ${businessId}, ${months})`),
  );

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  app = createDatabase({ url: testDb.appUrl, ids, maxConnections: 1 });
});

beforeEach(async () => {
  await owner`DELETE FROM business_settings`;
});

afterEach(async () => {
  await restoreNarrowConstraint();
});

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await testDb?.drop();
});

it('both migrations carry the exact column-0 marker and parse into the expected statements', () => {
  for (const tag of Object.values(CHECK_TAGS)) {
    const text = migrationText(tag);
    expect(text.split('\n')[0]).toBe(MARKER);
    expect(text.startsWith(`${MARKER}\n`)).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    // العلامة محجوزة للمصحح بس: أي سطر تاني فيه «pospay:» يوقف الترحيل كله.
    expect(text.split('\n').filter((line) => line.includes('pospay:'))).toEqual([MARKER]);
  }
  const check = parseMigrationStatements(migrationText(CHECK_TAGS.check));
  expect(check).toHaveLength(2);
  expect(check[0]).toContain(
    'ALTER TABLE "business_settings" DROP CONSTRAINT "business_settings_staff_months_back"',
  );
  expect(check[1]).toContain('ADD CONSTRAINT "business_settings_staff_months_back" CHECK');
  expect(check[1]).toContain('BETWEEN 1 AND 12');
  expect(check[1]).toContain('NOT VALID');
  const validate = parseMigrationStatements(migrationText(CHECK_TAGS.validate));
  expect(validate).toHaveLength(1);
  expect(validate[0]).toContain(
    'ALTER TABLE "business_settings" VALIDATE CONSTRAINT "business_settings_staff_months_back"',
  );
});

it('the migrated CHECK is validated on 1..12 and refuses 0, 13, 24 and 25 while accepting null, 1 and 12', async () => {
  const [constraint] = await constraintRow();
  expect(constraint?.convalidated).toBe(true);
  // Postgres بتطبع المدى في صورة مفصولة: (>= 1) AND (<= 12)، مفيش 24 خالص.
  expect(constraint?.definition).toContain('(staff_months_back >= 1)');
  expect(constraint?.definition).toContain('(staff_months_back <= 12)');
  expect(constraint?.definition).not.toContain('24');
  const refusal = { cause: { code: '23514', constraint_name: CONSTRAINT } };
  for (const months of [0, 13, 24, 25]) {
    const businessId = await businessFor(A.company, `Contract ${months}`);
    await expect(insertAsApp(businessId, months)).rejects.toMatchObject(refusal);
  }
  for (const months of [null, 1, 12]) {
    const businessId = await businessFor(A.company, `Contract accepted ${months}`);
    await expect(insertAsApp(businessId, months)).resolves.toBeDefined();
  }
  const stored = await businessFor(A.company, 'Contract stored');
  await insertAsApp(stored, 12);
  await expect(
    app.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE business_settings SET staff_months_back = 13
        WHERE company_id = ${A.company} AND business_id = ${stored}`),
    ),
  ).rejects.toMatchObject(refusal);
});

it('clamps only the values above 12, keeps 1, 12 and null, leaves staff_columns alone and is idempotent', async () => {
  await dropConstraint();
  await addConstraint(CHECK_LEGACY, false);
  try {
    const a13 = await businessFor(A.company, 'Legacy A 13');
    const a12 = await businessFor(A.company, 'Legacy A 12');
    const a1 = await businessFor(A.company, 'Legacy A 1');
    const b18 = await businessFor(B.company, 'Legacy B 18');
    const b24 = await businessFor(B.company, 'Legacy B 24');
    const bNull = await businessFor(B.company, 'Legacy B null');
    await insertSettings(A.company, a13, 13, ['date', 'service']);
    await insertSettings(A.company, a12, 12, null);
    await insertSettings(A.company, a1, 1, ['tip']);
    await insertSettings(B.company, b18, 18, ['date']);
    await insertSettings(B.company, b24, 24, null);
    await insertSettings(B.company, bNull, null, ['time']);

    expect(await clampStaffMonthsBack(owner, app)).toEqual({
      companies: 2,
      read: 6,
      clamped: 3,
    });
    expect(await monthsOf(A.company)).toEqual({ [a13]: 12, [a12]: 12, [a1]: 1 });
    expect(await monthsOf(B.company)).toEqual({ [b18]: 12, [b24]: 12, [bNull]: null });
    expect(await columnsOf(A.company)).toEqual({
      [a13]: ['date', 'service'],
      [a12]: null,
      [a1]: ['tip'],
    });
    expect(await columnsOf(B.company)).toEqual({
      [b18]: ['date'],
      [b24]: null,
      [bNull]: ['time'],
    });
    expect(await clampStaffMonthsBack(owner, app)).toEqual({
      companies: 2,
      read: 6,
      clamped: 0,
    });
  } finally {
    await restoreNarrowConstraint();
  }
  const [validated] = await constraintRow();
  expect(validated?.convalidated).toBe(true);
});

it('the reviewed registry entry runs the same step and logs the counters', async () => {
  const entry = REVIEWED_DATA_STEPS['staff-months-back'];
  if (entry === undefined) throw new Error('the staff-months-back step is not registered');
  const registryApp = createDatabase({ url: testDb.appUrl, ids, maxConnections: 1 });
  const logged: string[] = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
  await dropConstraint();
  await addConstraint(CHECK_LEGACY, false);
  const businessId = await businessFor(A.company, 'Registry step 13');
  try {
    await insertSettings(A.company, businessId, 13, null);
    await entry.run(owner, registryApp, { ownerUrl: testDb.ownerUrl });
  } finally {
    spy.mockRestore();
    await restoreNarrowConstraint();
  }
  const output = logged.join('\n');
  expect(output).toContain('[data-step:staff-months-back]');
  expect(output).toContain('companies=2');
  expect(output).toContain('read=1');
  expect(output).toContain('clamped=1');
  expect(await monthsOf(A.company)).toEqual({ [businessId]: 12 });
});

it('refuses a migration role with no isolation bypass before reading anything', async () => {
  const restricted = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    const failure = clampStaffMonthsBack(restricted, app);
    await expect(failure).rejects.toBeInstanceOf(StaffMonthsBackRoleRefusedError);
    await expect(failure).rejects.toMatchObject({ code: '42501' });
    await expect(failure).rejects.toThrow(
      'Migration data step staff-months-back needs a superuser or BYPASSRLS migration role; it would read no companies under FORCE RLS',
    );
  } finally {
    await restricted.end();
  }
});
