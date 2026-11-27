import { randomUUID } from 'node:crypto';
import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../packages/db/test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../../packages/db/test/test-database.ts';
import { recoveryEmailReader } from './recovery-email.ts';

// القارئ المربوط في العامل بيرجّع إيميل الاستعادة لموظفة واحدة بدخول سارٍ في شركتها، وغير كده null.
const ids = systemUuidV7();
const { A, B } = TENANT;
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;
let counter = 2000;

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

async function staff(
  tenant: typeof A,
  email: string | null,
  state: string,
  deleted = false,
): Promise<string> {
  const userId = randomUUID();
  const employee = randomUUID();
  counter += 1;
  await owner`INSERT INTO "user"(id,name,email) VALUES (${userId},'Synthetic',${`staff-${userId}@staff.pospay.invalid`})`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number,recovery_email,deleted_at)
    VALUES (${tenant.company},${employee},${tenant.business},${tenant.branch},'Synthetic','synthetic','staff','2026-01-01',${counter},${email},${deleted ? new Date() : null})`;
  // المكتبة بتقرا السجل والمستخدم بس: العضوية مش محل الاختبار، فقيد مفتاحها الأجنبي بيتعطّل في المعاملة.
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`INSERT INTO employee_staff_access(company_id,id,business_id,employee_id,operation_id,user_id,membership_id,role_code,branch_id,attempt_id,phone_hash,state,granted_by)
      VALUES (${tenant.company},${randomUUID()},${tenant.business},${employee},${randomUUID()},${userId},${randomUUID()},'staff',${tenant.branch},${randomUUID()},${'a'.repeat(64)},${state},${userId})`;
  });
  return userId;
}

it('reads the address of an active employee inside her own company only', async () => {
  const read = recoveryEmailReader(db);
  const active = await staff(A, 'active@example.test', 'ACTIVE');
  expect(await read(A.company, active)).toBe('active@example.test');
  expect(await read(B.company, active)).toBeNull();
});

it('returns null for a stopped access record, a deleted employee or no address', async () => {
  const read = recoveryEmailReader(db);
  expect(await read(A.company, await staff(A, 'stopped@example.test', 'STOPPED'))).toBeNull();
  expect(await read(A.company, await staff(A, 'deleted@example.test', 'ACTIVE', true))).toBeNull();
  expect(await read(A.company, await staff(A, null, 'ACTIVE'))).toBeNull();
});
