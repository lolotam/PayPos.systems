import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, SYSTEM_ROLES, type Database, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { ratingCommentReaders } from '../persistence/rating-comment-readers.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const AT = new Date('2026-06-01T00:00:00.000Z');
const PERMISSION = 'read:ratings:branch';
const A = TENANT.A;
type Scope = 'COMPANY' | 'BUSINESS' | 'BRANCH';
const role = (code: string): string => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

async function addUser(label: string): Promise<string> {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${id},${label},${`${id}@example.test`})`;
  return id;
}

interface MemberOptions {
  readonly company?: string;
  readonly roleId: string;
  readonly ownerKey?: string;
  readonly scope?: Scope;
  readonly scopeId?: string;
  readonly startsAt?: string;
  readonly endsAt?: string | null;
}

/** عضوية جديدة لمستخدم جديد؛ الافتراضي عضوية سارية بنطاق فرع الشركة A. */
async function member(
  label: string,
  options: MemberOptions,
): Promise<{ user: string; id: string }> {
  const user = await addUser(label);
  return { user, id: await addMembership(user, options) };
}

async function addMembership(user: string, options: MemberOptions): Promise<string> {
  const id = ids.newId();
  const company = options.company ?? A.company;
  const scope = options.scope ?? 'BRANCH';
  const scopeId = options.scopeId ?? (scope === 'COMPANY' ? company : A.branch);
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${company},${id},${user},${options.roleId},${options.ownerKey ?? 'global'},${scope},${scopeId},
      ${options.startsAt ?? '2026-01-01T00:00:00Z'},${options.endsAt ?? null})`;
  return id;
}

async function addOverride(
  membershipId: string,
  userId: string,
  effect: 'ALLOW' | 'DENY',
  expiresAt: string | null = null,
): Promise<void> {
  await owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by,expires_at)
    VALUES(${A.company},${ids.newId()},${membershipId},${PERMISSION},${effect},'BRANCH',${A.branch},
      'Synthetic test override',${userId},${expiresAt})`;
}

const read = (users: readonly string[]) =>
  db.withTenant(A.company, (tx) =>
    ratingCommentReaders(tx, A.company, A.business, A.branch, users, AT),
  );

it('the four manager roles with a covering scope are readers, sorted and unique', async () => {
  const members = [
    await member('branch manager', { roleId: role('branch_manager') }),
    await member('business manager', {
      roleId: role('business_manager'),
      scope: 'BUSINESS',
      scopeId: A.business,
    }),
    await member('general manager', { roleId: role('general_manager'), scope: 'COMPANY' }),
    await member('owner', { roleId: role('owner'), scope: 'COMPANY' }),
  ];
  const users = members.map((m) => m.user);
  expect(await read([...users, ...users])).toEqual([...users].sort());
  expect(await read([])).toEqual([]);
});

it('a non-manager role and a custom role with a historic ALLOW are excluded', async () => {
  const cashier = await member('cashier', { roleId: role('cashier') });
  await addOverride(cashier.id, cashier.user, 'ALLOW');
  const customRole = ids.newId();
  await owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES(${customRole},${A.company},'synthetic_rating_reader','Synthetic rating reader')`;
  await owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${customRole},${A.company},${A.company},${PERMISSION})`;
  const custom = await member('custom', {
    roleId: customRole,
    ownerKey: A.company,
    scope: 'COMPANY',
  });
  expect(await read([cashier.user, custom.user])).toEqual([]);
});

it('another company, another branch and another business are never returned', async () => {
  const secondBranch = ids.newId();
  await owner`INSERT INTO branches(id,company_id,business_id,name_en)
    VALUES(${secondBranch},${A.company},${A.business},'Second branch')`;
  const otherBusiness = ids.newId();
  await owner`INSERT INTO businesses(id,company_id,vertical_type,name_en)
    VALUES(${otherBusiness},${A.company},'salon','Other business')`;
  const elsewhere = [
    await member('other branch', { roleId: role('branch_manager'), scopeId: secondBranch }),
    await member('other business', {
      roleId: role('business_manager'),
      scope: 'BUSINESS',
      scopeId: otherBusiness,
    }),
    await member('other company', {
      company: TENANT.B.company,
      roleId: role('owner'),
      scope: 'COMPANY',
    }),
  ];
  expect(await read(elsewhere.map((m) => m.user))).toEqual([]);
});

it('an expired or not yet started membership is excluded', async () => {
  const ended = await member('ended', {
    roleId: role('branch_manager'),
    endsAt: '2026-05-01T00:00:00Z',
  });
  const future = await member('future', {
    roleId: role('branch_manager'),
    startsAt: '2026-07-01T00:00:00Z',
  });
  expect(await read([ended.user, future.user])).toEqual([]);
});

it('a covering DENY removes the manager, from its own or a sibling membership, and an expired one does not', async () => {
  const own = await member('denied own', { roleId: role('branch_manager') });
  await addOverride(own.id, own.user, 'DENY');
  const sibling = await member('denied sibling', { roleId: role('branch_manager') });
  const siblingCashier = await addMembership(sibling.user, { roleId: role('cashier') });
  await addOverride(siblingCashier, sibling.user, 'DENY');
  const expired = await member('expired deny', { roleId: role('branch_manager') });
  await addOverride(expired.id, expired.user, 'DENY', '2026-05-01T00:00:00Z');
  expect(await read([own.user, sibling.user, expired.user])).toEqual([expired.user]);
});

it('the canonical owner ignores a DENY, and a branch-scoped owner role does not', async () => {
  const canonical = await member('canonical owner', { roleId: role('owner'), scope: 'COMPANY' });
  await addOverride(canonical.id, canonical.user, 'DENY');
  const scoped = await member('scoped owner', { roleId: role('owner') });
  await addOverride(scoped.id, scoped.user, 'DENY');
  expect(await read([canonical.user, scoped.user])).toEqual([canonical.user]);
});

it('a role changed to cashier after a grant, and an expired ALLOW override, are excluded', async () => {
  const demoted = await member('demoted', { roleId: role('branch_manager') });
  await addOverride(demoted.id, demoted.user, 'ALLOW');
  expect(await read([demoted.user])).toEqual([demoted.user]);
  await owner`UPDATE memberships SET role_id=${role('cashier')} WHERE company_id=${A.company} AND id=${demoted.id}`;
  expect(await read([demoted.user])).toEqual([]);
  const managerRole = role('branch_manager');
  const viaOverride = await member('override only', { roleId: role('branch_manager') });
  await addOverride(viaOverride.id, viaOverride.user, 'ALLOW', '2026-05-01T00:00:00Z');
  await owner`DELETE FROM role_permissions WHERE role_id=${managerRole} AND role_owner_key='global'
    AND permission_code=${PERMISSION}`;
  try {
    expect(await read([viaOverride.user])).toEqual([]);
  } finally {
    await owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES(${managerRole},'global',NULL,${PERMISSION}) ON CONFLICT DO NOTHING`;
  }
});

it('the reader runs one statement on the caller transaction and none for an empty input', async () => {
  const manager = await member('same transaction', { roleId: role('branch_manager') });
  let statements = 0;
  await db.withTenant(A.company, async (tx) => {
    const counting = {
      execute: (query: SQL) => {
        statements += 1;
        return tx.execute(query);
      },
    } as unknown as Tx;
    const before = await tx.execute<{ id: string }>(sql`SELECT txid_current()::text AS id`);
    expect(
      await ratingCommentReaders(counting, A.company, A.business, A.branch, [manager.user], AT),
    ).toEqual([manager.user]);
    expect(statements).toBe(1);
    expect(await ratingCommentReaders(counting, A.company, A.business, A.branch, [], AT)).toEqual(
      [],
    );
    expect(statements).toBe(1);
    const after = await tx.execute<{ id: string }>(sql`SELECT txid_current()::text AS id`);
    expect(after[0]?.id).toBe(before[0]?.id);
  });
});

it('answers for more candidates than the PostgreSQL parameter limit in one statement, with the real reader among them', async () => {
  const manager = await member('among many', { roleId: role('branch_manager') });
  const strangers = Array.from(
    { length: 70_000 },
    (_, n) => `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  );
  expect(await read([...strangers, manager.user])).toEqual([manager.user]);
});
