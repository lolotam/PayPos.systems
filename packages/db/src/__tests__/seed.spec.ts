import { readFile } from 'node:fs/promises';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import templates from '../../seed/vertical-templates.json' with { type: 'json' };
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { PERMISSIONS, PLATFORM_ROLES, SYSTEM_ROLES } from '../access-catalog.ts';
import { ROLE_DEFAULTS } from '../role-defaults.ts';
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

it('migrations install card-clock reception defaults before any seed runs', async () => {
  const grants = await owner`SELECT r.code,rp.permission_code FROM role_permissions rp
    JOIN roles r ON r.id=rp.role_id AND r.owner_key=rp.role_owner_key
    WHERE r.company_id IS NULL AND (rp.permission_code='clock:attendance:branch'
      OR (r.code='cashier' AND rp.permission_code='login:staff:branch')) ORDER BY r.code,rp.permission_code`;
  expect(grants).toEqual([
    { code: 'branch_manager', permission_code: 'clock:attendance:branch' },
    { code: 'business_manager', permission_code: 'clock:attendance:branch' },
    { code: 'cashier', permission_code: 'clock:attendance:branch' },
    { code: 'cashier', permission_code: 'login:staff:branch' },
    { code: 'general_manager', permission_code: 'clock:attendance:branch' },
    { code: 'owner', permission_code: 'clock:attendance:branch' },
    { code: 'shift_supervisor', permission_code: 'clock:attendance:branch' },
  ]);
});
it('migrations install commission plan defaults globally before any seed runs', async () => {
  const grants = await owner`SELECT r.code,rp.permission_code FROM role_permissions rp
    JOIN roles r ON r.id=rp.role_id AND r.owner_key=rp.role_owner_key
    WHERE r.company_id IS NULL AND rp.permission_code='manage:commission-plans:business'
    ORDER BY r.code`;
  expect(grants).toEqual([
    { code: 'accountant', permission_code: 'manage:commission-plans:business' },
    { code: 'owner', permission_code: 'manage:commission-plans:business' },
  ]);
});

// توقع مستقل لحزم PR 16؛ بقية المرجع يغطيه اختبار المصفوفة الكاملة.
function expectedScheduleGrants() {
  return SYSTEM_ROLES.flatMap((r) => {
    const codes = [
      ...(['owner', 'general_manager', 'business_manager', 'branch_manager'].includes(r.code)
        ? ['read:schedules:branch', 'manage:schedules:branch']
        : []),
      ...(['owner', 'general_manager', 'business_manager'].includes(r.code)
        ? ['read:schedules:business', 'manage:schedules:business']
        : []),
    ];
    return codes.map((permission_code) => ({ role_id: r.id, permission_code }));
  }).sort(
    (a, b) =>
      a.permission_code.localeCompare(b.permission_code) || a.role_id.localeCompare(b.role_id),
  );
}

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
    // the 13 provisional tenant roles (D-07) and the fixed Device role (ADR-0003 §4 path B)
    expect(SYSTEM_ROLES).toHaveLength(14);
  });

  it('seeds the complete stored system bundles and never grants platform permission', async () => {
    const actual = await owner<
      { role_id: string; permission_code: string }[]
    >`SELECT role_id, permission_code
      FROM role_permissions WHERE role_owner_key = 'global' ORDER BY permission_code, role_id`;
    const expected = PERMISSIONS.flatMap((permission) => {
      const roles: readonly string[] = ROLE_DEFAULTS[permission];
      return SYSTEM_ROLES.filter((r) => roles.includes(r.code)).map((r) => ({
        role_id: r.id,
        permission_code: permission,
      }));
    }).sort(
      (a, b) =>
        a.permission_code.localeCompare(b.permission_code) || a.role_id.localeCompare(b.role_id),
    );
    expect(Array.from(actual)).toEqual(expected);
  });

  it('preserves PR 16 schedule bundles and PR 10 no salary role defaults', async () => {
    const rows = await owner<
      { role_id: string; permission_code: string }[]
    >`SELECT role_id,permission_code FROM role_permissions WHERE role_owner_key='global'
        AND permission_code LIKE '%:schedules:%' ORDER BY permission_code,role_id`;
    expect(Array.from(rows)).toEqual(expectedScheduleGrants());
    expect(
      await owner`SELECT 1 FROM role_permissions WHERE permission_code IN
      ('read:salaries:business','manage:salaries:business')`,
    ).toHaveLength(0);
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

it('CS-Q27 an accountant of a company created before the permission migration holds manage:commission-plans:business', async () => {
  await seedTwoTenants(testDb.ownerUrl);
  const membershipId = '01920000-0000-7000-8000-000000000487';
  const accountantRole = SYSTEM_ROLES.find((role) => role.code === 'accountant')?.id as string;
  await owner`INSERT INTO "user"(id,name,email)
    VALUES(${USER},'Commission accountant','commission-accountant@example.test')`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES(${TENANT.A.company},${membershipId},${USER},${accountantRole},'global','BUSINESS',${TENANT.A.business})`;
  await owner`DELETE FROM role_permissions WHERE permission_code='manage:commission-plans:business'`;
  await owner`DELETE FROM permissions WHERE code='manage:commission-plans:business'`;

  const migration = await readFile(
    new URL('../../migrations/0187_2026-10-25_commission-plans-permission.sql', import.meta.url),
    'utf8',
  );
  for (const statement of migration.split('--> statement-breakpoint')) {
    const sql = statement.trim();
    if (sql.length > 0) await owner.unsafe(sql);
  }

  const granted = await owner<{ code: string; permission_code: string }[]>`
    SELECT r.code,rp.permission_code FROM memberships m
    JOIN roles r ON r.id=m.role_id AND r.owner_key=m.role_owner_key
    JOIN role_permissions rp ON rp.role_id=m.role_id AND rp.role_owner_key=m.role_owner_key
      AND rp.permission_code='manage:commission-plans:business'
    WHERE m.company_id=${TENANT.A.company} AND m.id=${membershipId}`;
  expect(granted).toEqual([
    { code: 'accountant', permission_code: 'manage:commission-plans:business' },
  ]);
  const forbidden = await owner<{ code: string }[]>`
    SELECT r.code FROM roles r
    JOIN role_permissions rp ON rp.role_id=r.id AND rp.role_owner_key=r.owner_key
      AND rp.permission_code='manage:commission-plans:business'
    WHERE r.company_id IS NULL AND r.code IN ('general_manager','device')`;
  expect(forbidden).toEqual([]);
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
