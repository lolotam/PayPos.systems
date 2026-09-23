import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import templates from '../../seed/vertical-templates.json' with { type: 'json' };
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { OWNER_ROLE_ID, PERMISSIONS, PLATFORM_ROLES, SYSTEM_ROLES } from '../access-catalog.ts';
import { FEATURE_FLAGS, seedReferenceData } from '../seed.ts';

let testDb: TestDatabase;
let owner: postgres.Sql;

beforeAll(async () => {
  testDb = await createTestDatabase();
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await owner.end();
  await testDb.drop();
});

describe('seedReferenceData', () => {
  it('writes one provisional plan with every module flag enabled, and is idempotent', async () => {
    await seedReferenceData(testDb.ownerUrl);
    await seedReferenceData(testDb.ownerUrl);
    const rows = await owner<{ code: string; feature_flags: Record<string, boolean> }[]>`
      SELECT code, feature_flags FROM plans`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('provisional');
    expect(rows[0]?.feature_flags).toEqual(Object.fromEntries(FEATURE_FLAGS.map((f) => [f, true])));
  });

  it('seeds the permission catalogue and the 13 provisional system roles from code', async () => {
    const perms = await owner<{ code: string }[]>`SELECT code FROM permissions ORDER BY code`;
    expect(perms.map((p) => p.code)).toEqual([...PERMISSIONS].sort());
    const roles = await owner<{ code: string }[]>`SELECT code FROM roles WHERE company_id IS NULL`;
    expect(roles.map((r) => r.code).sort()).toEqual(SYSTEM_ROLES.map((r) => r.code).sort());
    expect(SYSTEM_ROLES).toHaveLength(13);
  });

  it('gives Owner every tenant permission and every other system role none (TODO(spec) D-07)', async () => {
    const owned = await owner<{ role_id: string; permission_code: string }[]>`
      SELECT role_id, permission_code FROM role_permissions ORDER BY permission_code`;
    expect(owned.every((r) => r.role_id === OWNER_ROLE_ID)).toBe(true);
    expect(owned.map((r) => r.permission_code)).toEqual(
      PERMISSIONS.filter((p) => !p.endsWith(':platform')).sort(),
    );
  });

  it('seeds the five provisional platform roles into platform_roles, never into the tenant roles table', async () => {
    await seedReferenceData(testDb.ownerUrl);
    const platform = await owner<{ code: string }[]>`SELECT code FROM platform_roles ORDER BY code`;
    expect(platform.map((r) => r.code)).toEqual(PLATFORM_ROLES.map((r) => r.code).sort());
    const leaked = await owner`
      SELECT 1 FROM roles WHERE code = ANY(${PLATFORM_ROLES.map((r) => r.code)}::text[])`;
    expect(leaked).toHaveLength(0);
  });

  it('creates no company — an owner-less company is forbidden (ADR-0003 §5.3)', async () => {
    const [row] = await owner`SELECT count(*)::int AS n FROM companies`;
    expect(row).toEqual({ n: 0 });
  });
});

describe('vertical templates (PRD §7.1)', () => {
  it('cover exactly the verticals the businesses table accepts', () => {
    expect(Object.keys(templates.templates).sort()).toEqual([
      'laundry',
      'restaurant',
      'retail',
      'salon',
      'services',
    ]);
  });

  it('enable only modules that have a feature flag', () => {
    const known = new Set<string>(FEATURE_FLAGS);
    for (const template of Object.values(templates.templates)) {
      expect(template.modules.filter((module) => !known.has(module))).toEqual([]);
    }
  });
});
