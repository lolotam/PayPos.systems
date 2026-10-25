import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { createDatabase, lockStatementPeriods, type Database, type Tx } from '../index.ts';
import {
  expectLockBeforeFirstWrite,
  type StatementLockOrderOptions,
} from '../../test/statement-lock-order.ts';
import {
  COMMISSION_TENANT,
  seedCommissionStatementTenants,
} from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

const { A } = COMMISSION_TENANT;
const ids = systemUuidV7();
let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedCommissionStatementTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`CREATE TABLE statement_lock_probe(company_id uuid, id uuid, note text)`;
  await owner`GRANT SELECT, INSERT ON statement_lock_probe TO pospay_app`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const options = (
  period: string,
  writer: StatementLockOrderOptions['writer'],
): StatementLockOrderOptions => ({
  db,
  ownerUrl: testDb.ownerUrl,
  companyId: A.company,
  businessId: A.business,
  period,
  ids,
  inputTables: ['statement_lock_probe'],
  writer,
});

const insertProbe = (tx: Tx) =>
  tx.execute(
    sql`INSERT INTO statement_lock_probe(company_id,id,note) VALUES (${A.company},${ids.newId()},'probe')`,
  );

it('accepts a writer that locks the statement before its first input write', async () => {
  await expectLockBeforeFirstWrite(
    options('2028-01', async (tx) => {
      await lockStatementPeriods(tx, { businessId: A.business, periods: ['2028-01'], ids });
      await insertProbe(tx);
    }),
  );
});

it('rejects a writer that writes an input table before taking the statement lock', async () => {
  await expect(
    expectLockBeforeFirstWrite(
      options('2028-02', async (tx) => {
        await insertProbe(tx);
        await lockStatementPeriods(tx, { businessId: A.business, periods: ['2028-02'], ids });
      }),
    ),
  ).rejects.toThrow('statement_lock_probe was written before lockStatementPeriods');
});

it('rejects a writer that never takes the statement lock', async () => {
  await expect(
    expectLockBeforeFirstWrite({ ...options('2028-03', insertProbe), timeoutMs: 1_000 }),
  ).rejects.toThrow('the writer never blocked on the statement lock');
});

it('rejects a writer that takes the statement row lock by hand', async () => {
  await expect(
    expectLockBeforeFirstWrite(
      options('2028-04', async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM commission_statements
            WHERE company_id = ${A.company} AND business_id = ${A.business} AND period = '2028-04'
            FOR UPDATE`,
        );
      }),
    ),
  ).rejects.toThrow('the writer blocked on something other than lockStatementPeriods');
});
