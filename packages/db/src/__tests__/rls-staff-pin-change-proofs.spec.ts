import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { expectPgError } from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// عزل RLS لجدول أدلة تغيير الرقم السري المؤقت (076 F2): الدليل نفسه مش بيتخزن، البصمة فقط،
// والدليل بيتحرق مرة واحدة. الجدول tenant data زي أي جدول شركة، والحماية إجبارية على pospay_app.
const { A, B } = TENANT;
const USER_A = '01920000-0000-7000-8000-0000000002f1';
const DEVICE_A = '01920000-0000-7000-8000-0000000002a1';
const DEVICE_B = '01920000-0000-7000-8000-0000000002b1';
const PROOF_A = '01920000-0000-7000-8000-0000000002c1';
const PROOF_B = '01920000-0000-7000-8000-0000000002c2';
const REVISION = '01920000-0000-7000-8000-0000000002d1';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

let testDb: TestDatabase;
let db: Database;

const asTenant = (companyId: string, query: SQL) =>
  db.withTenant(companyId, async (tx) => Array.from(await tx.execute(query)));

const insertFor = (companyId: string, id: string, deviceId: string, proofHash: string): SQL => sql`
  INSERT INTO staff_pin_change_proofs
    (company_id, id, proof_hash, device_id, user_id, pin_revision, expires_at)
  VALUES (${companyId}, ${id}, ${proofHash}, ${deviceId}, ${USER_A}, ${REVISION},
          clock_timestamp() + interval '10 minutes')
  RETURNING id`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seedTwoTenants(testDb.ownerUrl);
    await owner`INSERT INTO "user" (id, name, email) VALUES (${USER_A}, 'Proof holder', 'proof@example.test')`;
    await owner`INSERT INTO devices (company_id, id, branch_id, label, status, approved_by, approved_at)
      VALUES (${A.company}, ${DEVICE_A}, ${A.branch}, 'Proof device A', 'ACTIVE', ${USER_A}, clock_timestamp()),
             (${B.company}, ${DEVICE_B}, ${B.branch}, 'Proof device B', 'ACTIVE', ${USER_A}, clock_timestamp())`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => PROOF_A } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

it('the change-proof table carries forced row-level security and the three tenant policies', async () => {
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const tables = await owner<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'staff_pin_change_proofs'`;
    expect(tables).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await owner<{ cmd: string }[]>`
      SELECT cmd FROM pg_policies WHERE tablename = 'staff_pin_change_proofs' ORDER BY cmd`;
    expect(policies.map((row) => row.cmd)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    const grants = await owner<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'staff_pin_change_proofs' AND grantee = 'pospay_app' ORDER BY privilege_type`;
    expect(grants.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    const others = await owner<{ grantee: string }[]>`
      SELECT grantee FROM information_schema.role_table_grants
      WHERE table_name = 'staff_pin_change_proofs' AND grantee <> 'pospay_app'`;
    expect(others).toEqual([]);
  } finally {
    await owner.end();
  }
});

it('company B reads none of the proofs of company A and cannot write one for A', async () => {
  const inserted = await asTenant(A.company, insertFor(A.company, PROOF_A, DEVICE_A, HASH_A));
  expect(inserted).toHaveLength(1);
  expect(await asTenant(A.company, sql`SELECT id FROM staff_pin_change_proofs`)).toEqual([
    { id: PROOF_A },
  ]);
  expect(await asTenant(B.company, sql`SELECT id FROM staff_pin_change_proofs`)).toEqual([]);
  await expectPgError(
    db.withTenant(B.company, (tx) => tx.execute(insertFor(A.company, PROOF_B, DEVICE_A, HASH_B))),
    '42501',
  );
  const crossUpdate = await db.withTenant(B.company, (tx) =>
    tx.execute(
      sql`UPDATE staff_pin_change_proofs SET consumed_at = clock_timestamp() WHERE id = ${PROOF_A}`,
    ),
  );
  expect(crossUpdate).toHaveLength(0);
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      tx.execute(sql`DELETE FROM staff_pin_change_proofs WHERE id = ${PROOF_A}`),
    ),
    '42501',
  );
  expect(
    await asTenant(A.company, sql`SELECT consumed_at FROM staff_pin_change_proofs WHERE id = ${PROOF_A}`),
  ).toEqual([{ consumed_at: null }]);
});

it('a session with no tenant set reads zero rows and cannot insert', async () => {
  const bare = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await bare`SELECT id FROM staff_pin_change_proofs`).toEqual([]);
    await expectPgError(
      bare`
        INSERT INTO staff_pin_change_proofs
          (company_id, id, proof_hash, device_id, user_id, pin_revision, expires_at)
        VALUES (${A.company}, ${PROOF_B}, ${HASH_B}, ${DEVICE_A}, ${USER_A}, ${REVISION},
                clock_timestamp() + interval '10 minutes')`,
      '42501',
    );
  } finally {
    await bare.end();
  }
});

it('the stored row keeps a digest and its metadata only — no raw proof column', async () => {
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const columns = await owner<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'staff_pin_change_proofs' ORDER BY column_name`;
    expect(columns.map((row) => row.column_name)).toEqual([
      'company_id',
      'consumed_at',
      'created_at',
      'device_id',
      'expires_at',
      'id',
      'pin_revision',
      'proof_hash',
      'user_id',
    ]);
  } finally {
    await owner.end();
  }
});

it('the same digest cannot be issued twice in one company', async () => {
  await expectPgError(
    db.withTenant(A.company, (tx) => tx.execute(insertFor(A.company, PROOF_B, DEVICE_A, HASH_A))),
    '23505',
  );
});
