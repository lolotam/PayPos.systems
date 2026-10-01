import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

let testDb: TestDatabase;
let db: Database;
const ID = '01920000-0000-7000-8000-0000000000c1';
const OTHER = '01920000-0000-7000-8000-0000000000c2';
const { A, B } = TENANT;
const run = (company: string, statement: SQL) =>
  db.withTenant(company, (tx) => tx.execute(statement));
const insert = (
  company: string,
  id: string,
  business: string | null = null,
  branch: string | null = null,
) => sql`
  INSERT INTO notification_attempts (company_id,id,business_id,branch_id,source_event_id,channel,template_key,
    template_revision,locale,provider_template_name,recipient_phone,recipient_hash,hash_key_id,phone_last3,
    safe_parameters,status,authorized_at,created_at,updated_at)
  VALUES (${company},${id},${business},${branch},${id},'whatsapp','test_notice',1,'ar','test_notice_ar',
    '+96500000001',decode(repeat('01',32),'hex'),'test-v1','001','[]','PENDING',now(),now(),now())`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
  await run(B.company, insert(B.company, ID, B.business, B.branch));
  await run(A.company, insert(A.company, OTHER, A.business, A.branch));
});
afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('notification tenant boundary on pospay_app', () => {
  it('cross-tenant read and update see zero rows', async () => {
    expect(
      await run(A.company, sql`SELECT id FROM notification_attempts WHERE id = ${ID}`),
    ).toHaveLength(0);
    expect(
      await run(
        A.company,
        sql`UPDATE notification_attempts SET updated_at = now() WHERE id = ${ID} RETURNING id`,
      ),
    ).toHaveLength(0);
    expect(
      await run(B.company, sql`SELECT id FROM notification_attempts WHERE id = ${ID}`),
    ).toHaveLength(1);
  });
  it('cross-tenant insert and upsert are rejected', async () => {
    await expect(
      run(A.company, insert(B.company, '01920000-0000-7000-8000-0000000000c3')),
    ).rejects.toThrow();
    await expect(
      run(
        A.company,
        sql`${insert(B.company, ID)} ON CONFLICT (company_id,id) DO UPDATE SET updated_at = now()`,
      ),
    ).rejects.toThrow();
  });
  it('no runtime DELETE is granted, even for own rows', async () => {
    await expect(
      run(A.company, sql`DELETE FROM notification_attempts WHERE id = ${OTHER}`),
    ).rejects.toThrow();
  });
  it('cannot rehome identity, change immutable revision or substitute a cross-tenant FK', async () => {
    await expect(
      run(
        A.company,
        sql`UPDATE notification_attempts SET company_id = ${B.company} WHERE id = ${OTHER}`,
      ),
    ).rejects.toThrow();
    await expect(
      run(
        A.company,
        sql`UPDATE notification_attempts SET template_revision = 2 WHERE id = ${OTHER}`,
      ),
    ).rejects.toThrow();
    await expect(
      run(
        A.company,
        insert(A.company, '01920000-0000-7000-8000-0000000000c4', B.business, B.branch),
      ),
    ).rejects.toThrow();
  });
});

describe('terminal and deadline safety', () => {
  it('terminal CHECK rejects retained phone and terminal transitions cannot reopen identity', async () => {
    await expect(
      run(A.company, sql`UPDATE notification_attempts SET status = 'FAILED' WHERE id = ${OTHER}`),
    ).rejects.toThrow();
    await run(
      A.company,
      sql`UPDATE notification_attempts SET status = 'FAILED', recipient_phone = NULL, failure_code = 'CONFIG_INVALID' WHERE id = ${OTHER}`,
    );
    await expect(
      run(
        A.company,
        sql`UPDATE notification_attempts SET status = 'PENDING', recipient_phone = '+96500000001' WHERE id = ${OTHER}`,
      ),
    ).rejects.toThrow();
  });
});

describe('additional safety checks', () => {
  it('transaction context does not leak onto an unscoped connection', async () => {
    const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
    try {
      await app.begin(async (tx) => {
        await tx`SELECT set_config('app.company_id', ${B.company}, true)`;
        expect(await tx`SELECT id FROM notification_attempts`).toHaveLength(1);
      });
      expect(await app`SELECT id FROM notification_attempts`).toHaveLength(0);
    } finally {
      await app.end();
    }
  });
  it.each(['authUrl', 'dispatcherUrl'] as const)('%s has no access to attempts', async (url) => {
    const restricted = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      await expect(restricted`SELECT id FROM notification_attempts`).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await restricted.end();
    }
  });
});
