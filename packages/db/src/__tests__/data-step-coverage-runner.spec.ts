import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import { readPgTestEnv } from '../../test/pg-env.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { materializeDataSteps } from '../data-steps/index.ts';
import type { DataStepApp, DataStepEntry } from '../data-steps/coverage.ts';
import { applyMigrations } from '../concurrent-migrations.ts';
import { sql } from 'drizzle-orm';

// اختبار مسار كامل على Postgres: خطوة معلنة INVALIDATES تمرّ من السجل (materializeDataSteps)
// إلى applyMigrations، وكل معاملة من معاملاتها ترفع جيل التغطية مرة واحدة (reason DATA_STEP)،
// وخطوة NONE لا ترفعه. قراءة الجيل من المالك فقط: pospay_app بلا أي صلاحية على الجدولين،
// وترتيب الإبطال قبل أول جملة من الجسم مثبت وحدوياً في data-step-coverage-wrapper.spec.ts.

const files = vi.hoisted(() => ({ sql: [] as string[] }));
vi.mock('drizzle-orm/migrator', () => ({
  readMigrationFiles: () => [
    { sql: files.sql, folderMillis: 9_999_999_999_999, hash: 'coverage-runner' },
  ],
}));

const COMPANY = TENANT.A.company;
let testDb: TestDatabase;
let owner: postgres.Sql;

/** جسم الخطوة: معاملتان كل واحدة كتابة مرئية على شركة الخطوة نفسها، والـpool يقفل في finally. */
async function twoTransactions(
  app: DataStepApp,
  marker: string,
): Promise<void> {
  try {
    for (let i = 0; i < 2; i++) {
      await app.withTenant(COMPANY, (tx) =>
        tx.execute(
          sql`UPDATE public.companies SET name_en = ${marker} WHERE id = ${COMPANY}::uuid`,
        ),
      );
    }
  } finally {
    await app.close();
  }
}

const invalidatingStep: DataStepEntry = {
  coverage: 'INVALIDATES',
  run: async (_owner, app) => twoTransactions(app, 'invalidates-step-ran'),
};

const noneStep: DataStepEntry = {
  coverage: 'NONE',
  run: async (_owner, app) => twoTransactions(app, 'none-step-ran'),
};

const generationOf = async (): Promise<{
  generation: number | null;
  reason: string;
  rows: number;
}> => {
  const [row] = await owner`SELECT generation::text AS generation, reason FROM
    commission_coverage_state WHERE company_id = ${COMPANY}::uuid`;
  return row === undefined
    ? { generation: null, reason: 'NO_ROW', rows: 0 }
    : { generation: Number(row['generation']), reason: String(row['reason']), rows: 1 };
};

const nameEnOf = async (): Promise<string | null> => {
  const [row] =
    await owner`SELECT name_en FROM companies WHERE id = ${COMPANY}::uuid`;
  return row === undefined ? null : String(row['name_en']);
};

const runStep = async (entry: DataStepEntry, name: string) => {
  // علامة marker في ملف الترحيل الوهمي هي الوحيدة التي تربط الخطوة بالتشغيلة (ADR-0038).
  files.sql = [`-- pospay:data-step ${name}\nSELECT 1`];
  const steps = materializeDataSteps(
    { [name]: entry },
    testDb.ownerUrl,
    readPgTestEnv().appPassword,
  );
  await applyMigrations(owner, 'unused', steps);
  await owner`DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'coverage-runner'
    OR created_at >= 9999999999999`;
};

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

beforeEach(async () => {
  // applyPending يتخطى أي ترحيل أقدم من آخر صف مسجّل؛ نمسح صفوف هذه التشغيلة قبل كل اختبار.
  files.sql = ['SELECT 1'];
  await owner`DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'coverage-runner'
    OR created_at >= 9999999999999`;
});

it('an INVALIDATES entry bumps the generation exactly once per transaction through the real runner', async () => {
  const before = await generationOf();
  await runStep(invalidatingStep, 'coverage-invalidate');
  const after = await generationOf();
  // معالجتان: bump واحد لكل معاملة بالضبط (الصف غايب قبله يعني ensure ثم bumpين)،
  // وسبب الإبطال DATA_STEP دليل الـwrapper (لا الجسم).
  expect(after.generation).toBe((before.generation ?? 0) + 2);
  expect(after.reason).toBe('DATA_STEP');
  expect(after.rows).toBe(1);
  // جسم الخطوة نفّذ فعلاً: آخر كتابة له مرئية على جدول الشركات.
  expect(await nameEnOf()).toBe('invalidates-step-ran');
});

it('a NONE entry leaves the generation and the reason exactly as they were, and its body runs', async () => {
  await runStep(invalidatingStep, 'coverage-invalidate');
  const before = await generationOf();
  expect(before.reason).toBe('DATA_STEP');
  await runStep(noneStep, 'coverage-none');
  expect(await generationOf()).toEqual(before);
  // جسم خطوة NONE نفّذ فعلاً (أثره مرئي) رغم أن الجيل لم يتحرك: الالتفاف مرّ بلا إبطال.
  expect(await nameEnOf()).toBe('none-step-ran');
});
