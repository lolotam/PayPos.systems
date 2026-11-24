import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { expectPgError } from '../../test/commission-statement-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// عزل RLS لجدول دعوات الأعضاء (076 G1): بصمة الإيميل وعمود الدور بس، وحماية المستأجر إجبارية
// على pospay_app. الجدول ما لوش صفوف عامة ومفيش role تاني ليه منح.
const { A, B } = TENANT;
const INVITATION_A = '01920000-0000-7000-8000-0000000001a1';
const INVITER = '01920000-0000-7000-8000-0000000001f1';
const EMAIL_HASH_A = 'a'.repeat(43);
const EMAIL_HASH_B = 'b'.repeat(43);

let testDb: TestDatabase;
let db: Database;

const asTenant = (companyId: string, query: SQL) =>
  db.withTenant(companyId, async (tx) => Array.from(await tx.execute(query)));

const insertFor = (companyId: string, id: string, emailHash: string): SQL => sql`
  INSERT INTO member_invitations
    (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state)
  VALUES (${companyId}, ${id}, ${emailHash}, 'accountant', 'COMPANY', ${companyId}, ${INVITER}, 'PENDING')
  RETURNING id`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seedTwoTenants(testDb.ownerUrl);
    await owner`INSERT INTO "user" (id, name, email) VALUES (${INVITER}, 'Inviter', 'inviter@example.test')`;
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => INVITATION_A } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

it('the invitations table carries forced row-level security and the three tenant policies', async () => {
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const tables = await owner<
      { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'member_invitations'`;
    expect(tables).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await owner<{ cmd: string }[]>`
      SELECT cmd FROM pg_policies WHERE tablename = 'member_invitations' ORDER BY cmd`;
    expect(policies.map((row) => row.cmd)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    const grants = await owner<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'member_invitations' AND grantee = 'pospay_app' ORDER BY privilege_type`;
    expect(grants.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  } finally {
    await owner.end();
  }
});

it('company B reads none of the invitations of company A and cannot write one for A', async () => {
  const inserted = await asTenant(A.company, insertFor(A.company, INVITATION_A, EMAIL_HASH_A));
  expect(inserted).toHaveLength(1);
  expect(await asTenant(A.company, sql`SELECT id FROM member_invitations`)).toEqual([
    { id: INVITATION_A },
  ]);
  expect(await asTenant(B.company, sql`SELECT id FROM member_invitations`)).toEqual([]);
  // صف على شركة A من جلسة B: سياسة الإدراج بترفض قبل أي مفتاح أجنبي.
  await expectPgError(
    db.withTenant(B.company, (tx) => tx.execute(insertFor(A.company, INVITATION_A, EMAIL_HASH_B))),
    '42501',
  );
  // تعديل صف A من جلسة B بلا أثر (الصف غير مرئي)، والحذف ممنوع أصلاً — مفيش DELETE grant.
  const crossUpdate = await db.withTenant(B.company, (tx) =>
    tx.execute(sql`UPDATE member_invitations SET state = 'CANCELLED' WHERE id = ${INVITATION_A}`),
  );
  expect(crossUpdate).toHaveLength(0);
  await expectPgError(
    db.withTenant(B.company, (tx) =>
      tx.execute(sql`DELETE FROM member_invitations WHERE id = ${INVITATION_A}`),
    ),
    '42501',
  );
  expect(
    await asTenant(A.company, sql`SELECT state FROM member_invitations WHERE id = ${INVITATION_A}`),
  ).toEqual([{ state: 'PENDING' }]);
});

it('a session with no tenant set reads zero rows and cannot insert', async () => {
  const bare = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await bare`SELECT id FROM member_invitations`).toEqual([]);
    await expectPgError(
      bare`
        INSERT INTO member_invitations
          (company_id, id, email_hash, role_code, scope_type, scope_id, invited_by, state)
        VALUES (${A.company}, ${INVITATION_A}, ${EMAIL_HASH_A}, 'accountant', 'COMPANY', ${A.company},
                ${INVITER}, 'PENDING')`,
      '42501',
    );
  } finally {
    await bare.end();
  }
});

it('the stored row keeps an email hash and role metadata only — no email, no token, no link column', async () => {
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    const columns = await owner<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'member_invitations' ORDER BY column_name`;
    const names = columns.map((row) => row.column_name);
    expect(names).toEqual([
      'company_id',
      'created_at',
      'email_hash',
      'id',
      'invited_by',
      'link_issued_at',
      'membership_id',
      'role_code',
      'scope_id',
      'scope_type',
      'state',
      'user_id',
    ]);
  } finally {
    await owner.end();
  }
});
