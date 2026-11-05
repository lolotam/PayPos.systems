import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { PERMISSIONS, SYSTEM_ROLES } from '../access-catalog.ts';
import { ROLE_DEFAULTS } from '../role-defaults.ts';
import { systemRolePolicy } from '../system-role-policy.ts';

const codes = [
  'read:service-sessions:own',
  'read:commissions:own',
  'read:attendance:own',
  'read:ratings:own',
] as const;
let database: TestDatabase;
let owner: postgres.Sql;
beforeAll(async () => {
  database = await createTestDatabase();
  owner = postgres(database.ownerUrl, { max: 1, onnotice: () => undefined });
});
afterAll(async () => {
  await owner?.end();
  await database?.drop();
});

it.each(codes)('D-A4 %s defaults and eligibility cover every human and exclude devices', (code) => {
  expect(PERMISSIONS).toContain(code);
  const humans = SYSTEM_ROLES.filter((role) => role.code !== 'device');
  expect([...ROLE_DEFAULTS[code]].sort()).toEqual(humans.map((role) => role.code).sort());
  for (const role of SYSTEM_ROLES) {
    expect(systemRolePolicy(role.id, 'global')?.permissions.includes(code)).toBe(
      role.code !== 'device',
    );
  }
});

it('migration installs exactly 52 global own-read links before seed and is repeatable', async () => {
  const readLinks = () => owner`SELECT r.code,rp.permission_code FROM role_permissions rp
    JOIN roles r ON r.id=rp.role_id AND r.owner_key=rp.role_owner_key
    WHERE rp.permission_code IN ${owner([...codes])} ORDER BY r.code,rp.permission_code`;
  const expected = SYSTEM_ROLES.filter((role) => role.code !== 'device')
    .flatMap((role) => codes.map((permission_code) => ({ code: role.code, permission_code })))
    .sort(
      (a, b) => a.code.localeCompare(b.code) || a.permission_code.localeCompare(b.permission_code),
    );
  expect(Array.from(await readLinks())).toEqual(expected);
  const migration = await readFile(
    new URL('../../migrations/0210_2026-11-05_staff-own-read-defaults.sql', import.meta.url),
    'utf8',
  );
  for (const statement of migration.split('--> statement-breakpoint'))
    await owner.unsafe(statement);
  expect(Array.from(await readLinks())).toEqual(expected);
});
