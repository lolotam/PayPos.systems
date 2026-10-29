import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { branchNames } from '../persistence/branch-names.ts';

const ids = systemUuidV7();
let testDb: TestDatabase, db: Database, owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function read(companyId: string, businessId: string, branchIds: readonly string[]) {
  return db.withTenant(companyId, (tx) => branchNames(tx, companyId, businessId, branchIds));
}

it('returns the names of the requested branches', async () => {
  await owner`UPDATE branches SET name_ar='حولي'
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.branch}`;
  const names = await read(TENANT.A.company, TENANT.A.business, [TENANT.A.branch]);
  expect(names.get(TENANT.A.branch)).toEqual({ nameAr: 'حولي', nameEn: 'Branch A' });
});

it('does not resolve a branch of another business in the same company', async () => {
  const otherBusiness = ids.newId();
  const otherBranch = ids.newId();
  await owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES(${otherBusiness},${TENANT.A.company},'salon','Business Other')`;
  await owner`INSERT INTO branches (id, company_id, business_id, name_en)
    VALUES(${otherBranch},${TENANT.A.company},${otherBusiness},'Other branch')`;
  const names = await read(TENANT.A.company, TENANT.A.business, [otherBranch]);
  expect(names.has(otherBranch)).toBe(false);
});

it('does not resolve a branch of another tenant', async () => {
  const names = await read(TENANT.A.company, TENANT.A.business, [TENANT.B.branch]);
  expect(names.has(TENANT.B.branch)).toBe(false);
});

it('keeps an inactive branch in the answer', async () => {
  await owner`UPDATE branches SET is_active=false
    WHERE company_id=${TENANT.A.company} AND id=${TENANT.A.branch}`;
  const names = await read(TENANT.A.company, TENANT.A.business, [TENANT.A.branch]);
  expect(names.has(TENANT.A.branch)).toBe(true);
});

it('reads nothing when no branch is requested', async () => {
  const names = await read(TENANT.A.company, TENANT.A.business, []);
  expect(names.size).toBe(0);
});
