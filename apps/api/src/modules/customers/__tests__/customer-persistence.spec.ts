import { inspect } from 'node:util';

import { createDatabase, type Database, type TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createCustomerTransactions } from '../persistence/drizzle-customer-transactions.ts';

const PHONE = '+12025550126';
const ID = '01920000-0000-7000-8000-000000000abc';
const actor = { companyId: TENANT.A.company, userId: USER };
const input = {
  id: ID,
  phone: PHONE,
  name: 'Synthetic\u0000name',
  locale: 'ar' as const,
  at: new Date('2026-10-01T00:00:00Z'),
};
let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

function expectPrivateFailure(error: unknown) {
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: 'CustomerPersistenceError',
    message: 'CUSTOMER_PERSISTENCE_FAILED',
  });
  expect(error).not.toHaveProperty('cause');
  expect(error).not.toHaveProperty('params');
  const diagnostics = inspect(error, { showHidden: true, depth: null });
  for (let start = 0; start <= PHONE.length - 4; start += 1) {
    expect(diagnostics.includes(PHONE.slice(start, start + 4))).toBe(false);
  }
}

it('reproduces real Postgres SQLSTATE 22021 when a NUL name bypasses the contract', async () => {
  await expect(
    db.withTenant(actor.companyId, (tx) =>
      tx.execute(sql`
    INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${actor.companyId}, ${ID}, ${input.name}, ${PHONE}, 'ar', now(), now())`),
    ),
  ).rejects.toMatchObject({ cause: { code: '22021' } });
});

it('sanitizes the real 22021 error both inside the callback and outside the transaction', async () => {
  const transactions = createCustomerTransactions(db, { newId: () => ID });
  let innerError: unknown;
  const error = await transactions
    .run(actor, async (scope) => {
      try {
        return await scope.findOrCreate(input);
      } catch (caught) {
        innerError = caught;
        throw caught;
      }
    })
    .catch((caught: unknown) => caught);
  expectPrivateFailure(innerError);
  expectPrivateFailure(error);
});

it('sanitizes a real unique-violation audit failure and rolls back the inserted customer', async () => {
  const transactions = createCustomerTransactions(db, { newId: () => ID });
  let innerError: unknown;
  const error = await transactions
    .run(actor, async (scope) => {
      await scope.findOrCreate({ ...input, name: 'Synthetic name' });
      await scope.audit.record({
        entity: 'customer',
        entityId: ID,
        action: 'created',
        after: { phone: '***126' },
      });
      try {
        await scope.audit.record({
          entity: 'customer',
          entityId: ID,
          action: 'created',
          after: { phone: PHONE },
        });
      } catch (caught) {
        innerError = caught;
        throw caught;
      }
    })
    .catch((caught: unknown) => caught);
  expectPrivateFailure(innerError);
  expectPrivateFailure(error);
  const rows = await db.withTenant(actor.companyId, (tx) =>
    tx.execute(sql`SELECT id FROM customers`),
  );
  expect(rows).toHaveLength(0);
});

it('sanitizes a real transaction-wrapper failure before the callback starts', async () => {
  const wrappers: TenantWrappers = {
    ...db,
    withTenant: (companyId, work, options) =>
      db.withTenant(
        companyId,
        async (tx) => {
          await tx.execute(sql`SELECT ${PHONE}::integer`);
          return work(tx);
        },
        options,
      ),
  };
  const transactions = createCustomerTransactions(wrappers, { newId: () => ID });
  const error = await transactions
    .run(actor, () => Promise.resolve('unreachable'))
    .catch((caught: unknown) => caught);
  expectPrivateFailure(error);
});
