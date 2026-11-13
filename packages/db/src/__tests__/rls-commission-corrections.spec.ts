import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, type Database } from '../index.ts';
import {
  COMMISSION_TENANT,
  expectPgError,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import {
  insertCommissionCorrection,
  insertCommissionGeneration,
  lockTargetStatement,
} from '../../test/commission-correction-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

type SQLQuery = ReturnType<typeof sql>;

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const { A, B } = COMMISSION_TENANT;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const asA = (query: SQLQuery) => db.withTenant(A.company, (tx) => tx.execute(query));
const asB = (query: SQLQuery) => db.withTenant(B.company, (tx) => tx.execute(query));

it('the two correction tables carry forced row-level security and the policies the app needs', async () => {
  const tables = await owner<
    { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
    WHERE relname IN ('commission_period_generations','commission_corrections')
    ORDER BY relname`;
  expect(tables.map((row) => [row.relname, row.relrowsecurity, row.relforcerowsecurity])).toEqual([
    ['commission_corrections', true, true],
    ['commission_period_generations', true, true],
  ]);
  const policies = await owner<{ tablename: string; cmd: string }[]>`
    SELECT tablename, cmd FROM pg_policies
    WHERE tablename IN ('commission_period_generations','commission_corrections')
    ORDER BY tablename, cmd`;
  expect(policies).toEqual([
    { tablename: 'commission_corrections', cmd: 'INSERT' },
    { tablename: 'commission_corrections', cmd: 'SELECT' },
    { tablename: 'commission_period_generations', cmd: 'INSERT' },
    { tablename: 'commission_period_generations', cmd: 'SELECT' },
    { tablename: 'commission_period_generations', cmd: 'UPDATE' },
  ]);
});

it('CM-R06: company B reads and writes none of the correction rows of company A', async () => {
  const statementId = await lockTargetStatement({
    db,
    companyId: A.company,
    businessId: A.business,
    period: '2026-11',
    ids,
  });
  let generationId = '';
  await db.withTenant(A.company, async (tx) => {
    generationId = await insertCommissionGeneration(tx, A, ids, { period: '2026-10' });
    await insertCommissionCorrection(tx, A, ids, statementId, {
      sourcePeriod: '2026-10',
      targetPeriod: '2026-11',
    });
  });
  expect(await asA(sql`SELECT id FROM commission_period_generations`)).toHaveLength(1);
  expect(await asA(sql`SELECT id FROM commission_corrections`)).toHaveLength(1);
  expect(await asB(sql`SELECT id FROM commission_period_generations`)).toEqual([]);
  expect(await asB(sql`SELECT id FROM commission_corrections`)).toEqual([]);
  // صف على شركة تانية: سياسة الإدراج بترفض قبل ما أي مفتاح أجنبي يتكلم.
  await expectPgError(
    db.withTenant(B.company, (tx) => insertCommissionGeneration(tx, A, ids, { period: '2026-09' })),
    '42501',
  );
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      insertCommissionCorrection(tx, A, ids, statementId, { sourceRef: 'line:foreign-tenant' }),
    ),
    '42501',
  );
  // تحديث صف شركة تانية: سياسة التحديث ما بتخليش صف واحد يتغيّر.
  expect(
    await asB(
      sql`UPDATE commission_period_generations SET generation=2 WHERE id=${generationId} RETURNING id`,
    ),
  ).toEqual([]);
  expect(
    await asA(sql`SELECT generation FROM commission_period_generations WHERE id=${generationId}`),
  ).toEqual([{ generation: 1 }]);
});

it('the application role may not truncate either correction table', async () => {
  await expectPgError(asA(sql`TRUNCATE commission_period_generations`), '42501');
  await expectPgError(asA(sql`TRUNCATE commission_corrections`), '42501');
});
