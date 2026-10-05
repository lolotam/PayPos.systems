import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT, seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

let testDb: TestDatabase;
let db: Database;
const ID = '01920000-0000-7000-8000-00000000ea01';
const OTHER = '01920000-0000-7000-8000-00000000ea02';
const EMAIL = 'synthetic.owner@example.invalid';
const { A, B } = TENANT;
const run = (company: string, statement: SQL) =>
  db.withTenant(company, (tx) => tx.execute(statement));
const insert = (company: string, id: string, business: string | null = null) => sql`
  INSERT INTO notification_attempts (company_id,id,business_id,source_event_id,channel,template_key,
    template_revision,locale,recipient_email,recipient_hash,hash_key_id,phone_last3,safe_parameters,status,authorized_at,created_at,updated_at)
  VALUES (${company},${id},${business},${id},'email','document_expiring',1,'ar',${EMAIL},
    decode(repeat('01',32),'hex'),'email-test-v1',NULL,'[]','PENDING',now(),now(),now())`;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
  await run(B.company, insert(B.company, ID));
  await run(A.company, insert(A.company, OTHER));
});
afterAll(async () => {
  await db.close();
  await testDb.drop();
});

it('email destination is isolated for reads, updates, inserts and upserts', async () => {
  expect(
    await run(A.company, sql`SELECT recipient_email FROM notification_attempts WHERE id = ${ID}`),
  ).toHaveLength(0);
  expect(
    await run(
      A.company,
      sql`UPDATE notification_attempts SET recipient_email = NULL WHERE id = ${ID} RETURNING id`,
    ),
  ).toHaveLength(0);
  await expect(
    run(A.company, insert(B.company, '01920000-0000-7000-8000-00000000ea03')),
  ).rejects.toThrow();
  await expect(
    run(
      A.company,
      sql`${insert(B.company, ID)} ON CONFLICT (company_id,id) DO UPDATE SET updated_at = now()`,
    ),
  ).rejects.toThrow();
});
it('cannot rehome email, mutate its retained identity, cross a tenant FK or DELETE', async () => {
  await expect(
    run(
      A.company,
      sql`UPDATE notification_attempts SET company_id = ${B.company} WHERE id = ${OTHER}`,
    ),
  ).rejects.toThrow();
  await expect(
    run(
      A.company,
      sql`UPDATE notification_attempts SET recipient_hash = decode(repeat('02',32),'hex') WHERE id = ${OTHER}`,
    ),
  ).rejects.toThrow();
  await expect(
    run(A.company, insert(A.company, '01920000-0000-7000-8000-00000000ea04', B.business)),
  ).rejects.toThrow();
  await expect(
    run(A.company, sql`DELETE FROM notification_attempts WHERE id = ${OTHER}`),
  ).rejects.toThrow();
});
it('checks channel-specific destinations and forbids replacing/restoring email', async () => {
  expect(
    await run(
      A.company,
      sql`SELECT has_function_privilege(current_user, 'notification_email_destination_guard()', 'EXECUTE') AS allowed`,
    ),
  ).toEqual([{ allowed: false }]);
  await expect(
    run(
      A.company,
      sql`UPDATE notification_attempts SET recipient_phone = '+96500000001' WHERE id = ${OTHER}`,
    ),
  ).rejects.toThrow();
  await expect(
    run(A.company, sql`UPDATE notification_attempts SET phone_last3 = '001' WHERE id = ${OTHER}`),
  ).rejects.toThrow();
  await expect(
    run(
      A.company,
      sql`UPDATE notification_attempts SET recipient_email = 'other@example.invalid' WHERE id = ${OTHER}`,
    ),
  ).rejects.toThrow();
  await expect(
    run(A.company, sql`UPDATE notification_attempts SET status = 'FAILED' WHERE id = ${OTHER}`),
  ).rejects.toThrow();
  await run(
    A.company,
    sql`UPDATE notification_attempts SET status = 'SENDING', execution_id = ${OTHER}, sending_at = now() WHERE id = ${OTHER}`,
  );
  await run(
    A.company,
    sql`UPDATE notification_attempts SET recipient_email = NULL WHERE id = ${OTHER}`,
  );
  await expect(
    run(
      A.company,
      sql`UPDATE notification_attempts SET recipient_email = ${EMAIL} WHERE id = ${OTHER}`,
    ),
  ).rejects.toThrow();
  await expect(
    run(A.company, sql`UPDATE notification_attempts SET status = 'PENDING' WHERE id = ${OTHER}`),
  ).rejects.toThrow();
  await run(
    A.company,
    sql`UPDATE notification_attempts SET status = 'FAILED', outcome_known = false, failure_code = 'NETWORK_UNKNOWN' WHERE id = ${OTHER}`,
  );
  await expect(
    run(
      A.company,
      sql`UPDATE notification_attempts SET recipient_email = ${EMAIL} WHERE id = ${OTHER}`,
    ),
  ).rejects.toThrow();
});
