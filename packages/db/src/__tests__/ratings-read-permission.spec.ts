import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { PERMISSIONS, SYSTEM_ROLES } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';

const PERMISSION = 'read:ratings:branch';
// RT-Q7: المديرون الأربعة وحدهم يقرأون التقييمات افتراضياً.
const DEFAULT_ROLES = ['owner', 'general_manager', 'business_manager', 'branch_manager'];

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

it('registers the read permission in the catalog and the permissions table', async () => {
  expect(PERMISSIONS).toContain(PERMISSION);
  const rows = await owner`SELECT code FROM permissions WHERE code = ${PERMISSION}`;
  expect(rows).toHaveLength(1);
});

it('grants the read permission to exactly the four manager roles in a fresh database', async () => {
  expect(await grantedRoles()).toEqual([...DEFAULT_ROLES].sort());
  const rows = await owner`SELECT role_owner_key, company_id FROM role_permissions
    WHERE permission_code = ${PERMISSION}`;
  expect(rows).toHaveLength(DEFAULT_ROLES.length);
  for (const row of rows) expect(row).toEqual({ role_owner_key: 'global', company_id: null });
});

it('never grants the read permission to any other system role, cashier, staff and device included', async () => {
  const others = SYSTEM_ROLES.filter((role) => !DEFAULT_ROLES.includes(role.code));
  expect(SYSTEM_ROLES.length - others.length).toBe(DEFAULT_ROLES.length);
  expect(others.map((role) => role.code)).toEqual(
    expect.arrayContaining(['cashier', 'staff', 'viewer', 'device']),
  );
  for (const role of others) {
    const rows = await owner`SELECT 1 FROM role_permissions
      WHERE role_id = ${role.id}::uuid AND permission_code = ${PERMISSION}`;
    expect(rows, role.code).toHaveLength(0);
  }
});

it('is idempotent: applying the migration statements again adds and changes nothing', async () => {
  const before = await snapshot();
  expect(before.permissions).toHaveLength(1);
  expect(before.grants).toHaveLength(DEFAULT_ROLES.length);
  for (const statement of migrationStatements()) await owner.unsafe(statement);
  expect(await snapshot()).toEqual(before);
});

it('upgrades a legacy database by applying the migration alone, with no reseed', async () => {
  // الحالة قبل الترحيل: الأدوار موجودة والصلاحية ومنحها لسه مش متزرعة.
  await owner`DELETE FROM role_permissions WHERE permission_code = ${PERMISSION}`;
  await owner`DELETE FROM permissions WHERE code = ${PERMISSION}`;
  expect(await grantedRoles()).toEqual([]);

  for (const statement of migrationStatements()) await owner.unsafe(statement);

  expect(await grantedRoles()).toEqual([...DEFAULT_ROLES].sort());
  const others = await owner`SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE rp.permission_code = ${PERMISSION} AND r.code <> ALL(${DEFAULT_ROLES})`;
  expect(others).toHaveLength(0);
});

/** الأدوار العالمية اللي منحها الترحيل للصلاحية دي. */
async function grantedRoles(): Promise<readonly string[]> {
  const rows = await owner`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE rp.role_owner_key = 'global' AND rp.permission_code = ${PERMISSION} ORDER BY r.code`;
  return rows.map((row) => row['code'] as string);
}

/** لقطة كاملة لصف الصلاحية ومنحها، لمقارنة ما قبل التطبيق الثاني وما بعده. */
async function snapshot() {
  const permissions = await owner`SELECT * FROM permissions WHERE code = ${PERMISSION}`;
  const grants = await owner`SELECT * FROM role_permissions
    WHERE permission_code = ${PERMISSION} ORDER BY role_id`;
  return { permissions: [...permissions], grants: [...grants] };
}

/** جمل ملف الـ migration كما هو، مقسومة على فواصل drizzle. */
function migrationStatements(): readonly string[] {
  const directory = resolve('migrations');
  const file = readdirSync(directory).find((name) => name.startsWith('0240_'));
  if (file === undefined) throw new Error('the 0240 migration file is missing');
  return readFileSync(resolve(directory, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.replace(/^--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}
