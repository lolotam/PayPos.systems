import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { TENANT, USER, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { INBOX_ID, seedInboxUsers } from '../../test/in-app-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

let testDb: TestDatabase;
let db: Database;
const insert = (
  company: string,
  business: string | null = null,
  branch: string | null = null,
) => sql`
  INSERT INTO in_app_notifications (company_id,id,recipient_user_id,business_id,branch_id,
    source_event_id,template_key,template_revision,locale,safe_parameters,created_at)
  VALUES (${company},${INBOX_ID},${USER},${business},${branch},${INBOX_ID},'generic_notice',1,'ar',
    '[{"name":"subject","type":"text","value":"Synthetic subject"}]',now())`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seedInboxUsers(owner);
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => INBOX_ID } });
  await db.withTenant(TENANT.B.company, (tx) => tx.execute(insert(TENANT.B.company)));
});
afterAll(async () => {
  await db.close();
  await testDb.drop();
});

it('restricted role reads and updates zero cross-company rows; insert/upsert/FKs fail', async () => {
  const { A, B } = TENANT;
  expect(
    await db.withTenant(A.company, (tx) => tx.execute(sql`SELECT id FROM in_app_notifications`)),
  ).toHaveLength(0);
  expect(
    await db.withTenant(A.company, (tx) =>
      tx.execute(sql`UPDATE in_app_notifications SET read_at = now() RETURNING id`),
    ),
  ).toHaveLength(0);
  await expect(db.withTenant(A.company, (tx) => tx.execute(insert(B.company)))).rejects.toThrow();
  await expect(
    db.withTenant(A.company, (tx) =>
      tx.execute(
        sql`${insert(B.company)} ON CONFLICT (company_id,id) DO UPDATE SET read_at = now()`,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    db.withTenant(A.company, (tx) => tx.execute(insert(A.company, B.business, B.branch))),
  ).rejects.toThrow();
  await expect(
    db.withTenant(A.company, (tx) => tx.execute(insert(A.company, null, A.branch))),
  ).rejects.toThrow();
});

it('identity cannot be rehomed and a read acknowledgment cannot be undone or changed', async () => {
  const company = TENANT.B.company;
  await expect(
    db.withTenant(company, (tx) =>
      tx.execute(sql`UPDATE in_app_notifications SET company_id = ${TENANT.A.company}`),
    ),
  ).rejects.toThrow();
  await expect(
    db.withTenant(company, (tx) =>
      tx.execute(
        sql`UPDATE in_app_notifications SET recipient_user_id = ${'01920000-0000-7000-8000-0000000000f2'}`,
      ),
    ),
  ).rejects.toThrow();
  await db.withTenant(company, (tx) =>
    tx.execute(sql`UPDATE in_app_notifications SET read_at = '2026-10-01T12:00:00Z'`),
  );
  await expect(
    db.withTenant(company, (tx) => tx.execute(sql`UPDATE in_app_notifications SET read_at = NULL`)),
  ).rejects.toThrow();
  await expect(
    db.withTenant(company, (tx) =>
      tx.execute(sql`UPDATE in_app_notifications SET read_at = '2026-10-02T12:00:00Z'`),
    ),
  ).rejects.toThrow();
  await expect(
    db.withTenant(company, (tx) => tx.execute(sql`DELETE FROM in_app_notifications`)),
  ).rejects.toThrow();
});

it('unscoped app connections and other runtime roles cannot reach inbox rows', async () => {
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await app.begin(async (tx) => {
      await tx`SELECT set_config('app.company_id',${TENANT.B.company},true)`;
      expect(await tx`SELECT id FROM in_app_notifications`).toHaveLength(1);
    });
    expect(await app`SELECT id FROM in_app_notifications`).toHaveLength(0);
  } finally {
    await app.end();
  }
  for (const url of [testDb.authUrl, testDb.dispatcherUrl]) {
    const restricted = postgres(url, { max: 1, onnotice: () => undefined });
    try {
      await expect(restricted`SELECT id FROM in_app_notifications`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await restricted.end();
    }
  }
});
