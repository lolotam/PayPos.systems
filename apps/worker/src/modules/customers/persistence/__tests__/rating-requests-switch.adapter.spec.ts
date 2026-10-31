import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ratingRequestsSwitch } from '../rating-requests-switch.adapter.ts';

const ids = systemUuidV7();
const { A, B } = TENANT;
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','worker-switch@example.test')
    ON CONFLICT DO NOTHING`;
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const newBusiness = async (company: string): Promise<string> => {
  const id = ids.newId();
  await owner`INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, ${id}, 'Synthetic business', 'salon')`;
  return id;
};

const save = (company: string, business: string, enabled: boolean | null) =>
  owner`INSERT INTO rating_settings (company_id,id,business_id,requests_enabled,updated_by,updated_at,revision)
    VALUES (${company},${ids.newId()},${business},${enabled},${USER},now(),1)`;

const read = (company: string, business: string) =>
  db.withTenant(company, (tx) => ratingRequestsSwitch.enabled(tx, company, business));

it('a business with no row reads as off, the shared default', async () => {
  const business = await newBusiness(A.company);
  expect(await read(A.company, business)).toBe(false);
});

it('a saved row reads its own value', async () => {
  const business = await newBusiness(A.company);
  await save(A.company, business, true);
  expect(await read(A.company, business)).toBe(true);
});

it('a NULL value reads as off, the shared default', async () => {
  const business = await newBusiness(B.company);
  await save(B.company, business, null);
  expect(await read(B.company, business)).toBe(false);
});

it("another company's row never applies", async () => {
  const business = await newBusiness(A.company);
  await save(B.company, B.business, true);
  expect(await read(A.company, business)).toBe(false);
});
