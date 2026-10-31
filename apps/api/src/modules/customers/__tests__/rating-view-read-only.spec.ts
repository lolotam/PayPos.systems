import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { expectPgError } from '../../../../../../packages/db/test/rating-fixtures.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { createRatingViewTransactions } from '../persistence/drizzle-rating-submission-transactions.ts';

// معاملة الصفحة READ ONLY: الداتابيز نفسها بترفض أي كتابة (SQLSTATE 25006).
const READ_ONLY_SQL_TRANSACTION = '25006';

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: systemUuidV7() });
});

afterAll(async () => {
  await db?.close();
  await testDb?.drop();
});

it('refuses a write inside the view transaction at the database level', async () => {
  const transactions = createRatingViewTransactions(db, 5_000, {
    names: async (tx) => {
      await tx.execute(sql`UPDATE rating_requests SET updated_at = updated_at WHERE false`);
      return null;
    },
  });
  await expectPgError(
    transactions.run(TENANT.A.company, async (scope) => scope.businessNames(TENANT.A.business)),
    READ_ONLY_SQL_TRANSACTION,
  );
});

it('reads the business names inside the view transaction', async () => {
  const transactions = createRatingViewTransactions(db, 5_000, {
    names: async (tx, companyId, businessId) => {
      const [row] = await tx.execute<{ name_ar: string | null; name_en: string }>(
        sql`SELECT name_ar, name_en FROM businesses WHERE company_id=${companyId} AND id=${businessId}`,
      );
      if (row === undefined) return null;
      return { name_ar: row.name_ar, name_en: row.name_en };
    },
  });
  const names = await transactions.run(TENANT.A.company, async (scope) =>
    scope.businessNames(TENANT.A.business),
  );
  expect(names).toEqual({ name_ar: null, name_en: 'Business A' });
});
