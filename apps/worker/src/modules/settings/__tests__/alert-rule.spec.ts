import { afterAll, beforeAll, expect, it } from 'vitest';
import postgres from 'postgres';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { alertRule } from '../index.ts';

const ids = systemUuidV7();
const { A, B } = TENANT;
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
const sibling = ids.newId();
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user" (id,name,email) VALUES (${USER},'Synthetic user','worker-alerts@example.test')
    ON CONFLICT DO NOTHING`;
  await owner`INSERT INTO branches (id, company_id, business_id, name_en)
    VALUES (${sibling}, ${A.company}, ${A.business}, 'Synthetic sibling')`;
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const save = (company: string, business: string, branch: string | null, delay: number, enabled = true) =>
  owner`INSERT INTO alert_rules (company_id,id,business_id,branch_id,kind,enabled,recipient_roles,channels,
    delay_minutes,lead_minutes,updated_by,revision)
    VALUES (${company},${ids.newId()},${business},${branch},'SHIFT_NOT_CLOCKED_IN',${enabled},
      ARRAY['branch_manager']::text[],ARRAY['IN_APP']::text[],${delay},NULL,${USER},1)`;
const read = (branch: string | null, kind: 'SHIFT_NOT_CLOCKED_IN' | 'DOCUMENT_EXPIRING' = 'SHIFT_NOT_CLOCKED_IN') =>
  db.withTenant(A.company, (tx) =>
    alertRule(tx, A.company, { businessId: A.business, branchId: branch }, kind),
  );

it('defaults until a rule is saved; another company’s rule never applies', async () => {
  await save(B.company, B.business, null, 5, false);
  expect(await read(A.branch)).toMatchObject({ source: 'DEFAULT', enabled: true, delayMinutes: 20 });
});

it('RT-26b: the branch override for its branch, the business rule for the sibling and branch-less kinds', async () => {
  await save(A.company, A.business, null, 20);
  await save(A.company, A.business, A.branch, 10);
  expect(await read(A.branch)).toMatchObject({ source: 'BRANCH', delayMinutes: 10 });
  expect(await read(sibling)).toMatchObject({ source: 'BUSINESS', delayMinutes: 20 });
  expect(await read(null)).toMatchObject({ source: 'BUSINESS', delayMinutes: 20 });
  expect(await read(null, 'DOCUMENT_EXPIRING')).toMatchObject({ source: 'DEFAULT', enabled: true });
});

it('RT-26: the master switch off stops every kind on every branch', async () => {
  await owner`INSERT INTO business_settings (company_id,business_id,alerts_enabled)
    VALUES (${A.company},${A.business},false)`;
  for (const branch of [A.branch, sibling, null])
    expect(await read(branch)).toMatchObject({ enabled: false, masterOff: true, recipientRoles: [] });
  expect(await read(null, 'DOCUMENT_EXPIRING')).toMatchObject({ enabled: false, fixedRecipients: [] });
});
