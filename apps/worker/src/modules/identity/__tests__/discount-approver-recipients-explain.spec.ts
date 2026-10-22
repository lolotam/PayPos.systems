import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  discountApproverCandidatesStatement,
  discountApproverGrantsStatement,
  discountApproverRecipients,
} from '../persistence/discount-approver-recipients.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
// عضوية البذرة تبدأ بـ now()، فنقطة بعيدة في المستقبل تجعلها سارية بلا تعديل على البذرة.
const AT = new Date('2099-01-01T00:00:00.000Z');

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('the seed owner approves at its branch, and another company stays invisible', async () => {
  const recipients = await db.withTenant(TENANT.A.company, (tx) =>
    discountApproverRecipients(tx, TENANT.A.company, TENANT.A.business, TENANT.A.branch, AT),
  );
  expect(recipients).toEqual([USER]);
  const foreign = await db.withTenant(TENANT.A.company, (tx) =>
    discountApproverRecipients(tx, TENANT.B.company, TENANT.B.business, TENANT.B.branch, AT),
  );
  expect(foreign).toEqual([]);
});

it('the candidate and grant statements use tenant indexes', async () => {
  await owner`ANALYZE memberships`;
  await owner`ANALYZE role_permissions`;
  await owner`ANALYZE permission_overrides`;
  const candidates = JSON.stringify(
    await explain(
      discountApproverCandidatesStatement(TENANT.A.company, TENANT.A.business, TENANT.A.branch, AT),
    ),
  );
  expect(candidates).toMatch(/memberships_(pkey|scope_business_idx|scope_branch_idx|user_id_idx)/);
  expect(candidates).not.toContain('Seq Scan');
  const grants = JSON.stringify(
    await explain(
      discountApproverGrantsStatement(TENANT.A.company, TENANT.A.business, TENANT.A.branch, AT, [
        USER,
      ]),
    ),
  );
  expect(grants).toMatch(/memberships_(pkey|scope_business_idx|scope_branch_idx|user_id_idx)/);
  expect(grants).toMatch(/role_permissions_[a-z_]+/);
  expect(grants).toMatch(/permission_overrides_[a-z_]+/);
  expect(grants).not.toContain('Seq Scan');
}, 120_000);

/** الفهرس مطلوب لا المسح؛ disable_seqscan يجعل الخطة تُظهر الفهرس لا الشامل. */
function explain(statement: SQL) {
  return db.withTenant(TENANT.A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
}
