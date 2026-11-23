import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  RATING_TENANT,
  seedRatingTenants,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { ownRatingContext } from '../persistence/own-rating-context.adapter.ts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import postgres from 'postgres';

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: ReturnType<typeof createDatabase>;
const { A, B } = RATING_TENANT;
const ids = systemUuidV7();
const at = (month: number, day: number) => new Date(Date.UTC(2026, month - 1, day, 12));

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedRatingTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user"(id,name,email) VALUES (${USER},'Synthetic rater','rater@example.test')
  ON CONFLICT (id) DO NOTHING`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${A.company},${ids.newId()},${USER},id,'global','BRANCH',${A.branch},'2026-01-01'
    FROM roles WHERE code='staff' AND company_id IS NULL`;
  await owner`UPDATE "user" SET phone_number='+99900000001', phone_binding_approved_at='2026-01-01T00:00:00Z'
    WHERE id=${USER}`;
  await owner`UPDATE employees SET user_id=${USER} WHERE company_id=${A.company} AND id=${A.employees[0]}`;
  await owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${A.company},${ids.newId()},${A.business},${A.employees[0]},${A.branch},'2026-01-01')`;
});
afterAll(async () => {
  await owner.end();
  await db.close();
  await testDb.drop();
});

it('the real adapter refuses a business outside the company with null', async () => {
  const result = await db.withTenant(A.company, (tx) =>
    ownRatingContext(tx, { companyId: A.company, businessId: B.business, userId: USER }, at(6, 15)),
  );
  expect(result).toBeNull();
});

it('the real adapter resolves the own employee and the business timezone', async () => {
  const result = await db.withTenant(A.company, (tx) =>
    ownRatingContext(tx, { companyId: A.company, businessId: A.business, userId: USER }, at(6, 15)),
  );
  expect(result).toEqual({ employeeId: A.employees[0], timeZone: 'Asia/Kuwait' });
});
