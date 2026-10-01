import { myWorkspacesResponse } from '@pospay/contracts';
import {
  createDatabase,
  OWNER_ROLE_ID,
  SYSTEM_ROLES,
  type Database,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { myWorkspaces, type WorkspaceNames, type WorkspaceScope } from '../my-workspaces.query.ts';

// CLAUDE.md §9: the workspace read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A, B } = TENANT;
const FLOOR = '01920000-0000-7000-8000-0000000000d1';
const U = {
  none: '01920000-0000-7000-8000-0000000000e1',
  window: '01920000-0000-7000-8000-0000000000e2',
  wide: '01920000-0000-7000-8000-0000000000e3',
  tieTime: '01920000-0000-7000-8000-0000000000e4',
  tieId: '01920000-0000-7000-8000-0000000000e5',
  owned: '01920000-0000-7000-8000-0000000000e6',
  two: '01920000-0000-7000-8000-0000000000e7',
  drop: '01920000-0000-7000-8000-0000000000e8',
  explain: '01920000-0000-7000-8000-0000000000e9',
  bulk: '01920000-0000-7000-8000-0000000000ea',
} as const;

const seen: { companyId: string; scopes: WorkspaceScope[] }[] = [];
const omitted = new Set<string>();
const labels = new Map<string, string>();
const plans: string[] = [];

function roleId(code: string): string {
  const found = SYSTEM_ROLES.find((role) => role.code === code);
  if (found === undefined) throw new Error(`missing role ${code}`);
  return found.id;
}

const names: WorkspaceNames = {
  describe: async (tx, scopes) => {
    const [row] = Array.from(
      await tx.execute<{ id: string | null }>(sql`SELECT app_company_id() AS id`),
    );
    if (row?.id == null) throw new Error('workspace names were read outside withTenant');
    seen.push({ companyId: row.id, scopes: scopes.map((scope) => ({ ...scope })) });
    if (omitted.has(row.id)) return null;
    return { id: row.id, name_ar: null, name_en: labels.get(row.id) ?? 'Company', businesses: [] };
  },
};

let testDb: TestDatabase;
let db: Database;

function explaining(database: Database): TenantWrappers {
  const explain = (tx: Tx): Tx =>
    new Proxy(tx, {
      get: (target, property, receiver) =>
        property === 'execute'
          ? async (query: SQL) => {
              const [row] = await target.execute<{ plan: unknown }>(
                sql`EXPLAIN (ANALYZE, FORMAT JSON) ${query}`,
              );
              plans.push(JSON.stringify(Object.values(row ?? {})[0]));
              return target.execute(query);
            }
          : Reflect.get(target, property, receiver),
    });
  return {
    withUser: (userId, fn) => database.withUser(userId, (tx) => fn(explain(tx))),
    withNewTenant: (userId, fn) => database.withNewTenant(userId, (tx, id) => fn(explain(tx), id)),
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}

function load(userId: string) {
  return myWorkspaces(db, names, userId);
}

interface Member {
  readonly company: string;
  readonly id: string;
  readonly user: string;
  readonly role: string;
  readonly ownerKey?: string;
  readonly scope: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  readonly scopeId: string;
  readonly starts: string;
  readonly ends?: string;
}

function member(owner: postgres.Sql, row: Member) {
  return owner`
    INSERT INTO memberships (
      company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at, ends_at
    ) VALUES (
      ${row.company}, ${row.id}, ${row.user}, ${row.role}, ${row.ownerKey ?? 'global'},
      ${row.scope}, ${row.scopeId}, ${row.starts}::timestamptz, ${row.ends ?? null}
    )`;
}

async function seedUsers(owner: postgres.Sql): Promise<void> {
  for (const id of Object.values(U)) {
    await owner`INSERT INTO "user" (id, name, email) VALUES (${id}, 'U', ${`u-${id}@example.test`})`;
  }
  await owner`
    INSERT INTO roles (id, company_id, code, name_en)
    VALUES (${FLOOR}, ${A.company}, 'floor_lead', 'Floor lead')`;
}

function at(
  user: string,
  id: string,
  role: string,
  scope: Member['scope'],
  scopeId: string,
  starts: string,
  company: string = A.company,
): Member {
  return { company, id, user, role, scope, scopeId, starts };
}

async function seedWindows(owner: postgres.Sql, ownerRole: string, cashier: string): Promise<void> {
  await member(owner, {
    ...at(
      U.window,
      '01920000-0000-7000-8000-000000000201',
      ownerRole,
      'BRANCH',
      A.branch,
      '2020-01-01T00:00:00Z',
    ),
    ends: '2020-02-01T00:00:00Z',
  });
  await member(
    owner,
    at(
      U.window,
      '01920000-0000-7000-8000-000000000202',
      ownerRole,
      'COMPANY',
      A.company,
      '2999-01-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.window,
      '01920000-0000-7000-8000-000000000203',
      ownerRole,
      'BRANCH',
      A.branch,
      '2024-01-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.wide,
      '01920000-0000-7000-8000-000000000204',
      cashier,
      'BRANCH',
      A.branch,
      '2020-01-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.wide,
      '01920000-0000-7000-8000-000000000205',
      ownerRole,
      'COMPANY',
      A.company,
      '2024-06-01T00:00:00Z',
    ),
  );
}

async function seedTies(owner: postgres.Sql, ownerRole: string, cashier: string): Promise<void> {
  await member(
    owner,
    at(
      U.tieTime,
      '01920000-0000-7000-8000-000000000212',
      cashier,
      'BUSINESS',
      A.business,
      '2020-01-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.tieTime,
      '01920000-0000-7000-8000-000000000210',
      ownerRole,
      'BUSINESS',
      A.business,
      '2024-06-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.tieId,
      '01920000-0000-7000-8000-000000000220',
      ownerRole,
      'BRANCH',
      A.branch,
      '2024-01-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.tieId,
      '01920000-0000-7000-8000-000000000221',
      cashier,
      'BRANCH',
      A.branch,
      '2024-01-01T00:00:00Z',
    ),
  );
  await member(owner, {
    ...at(
      U.owned,
      '01920000-0000-7000-8000-000000000230',
      FLOOR,
      'COMPANY',
      A.company,
      '2024-01-01T00:00:00Z',
    ),
    ownerKey: A.company,
  });
}

async function seedCompanies(owner: postgres.Sql, ownerRole: string): Promise<void> {
  await member(
    owner,
    at(
      U.two,
      '01920000-0000-7000-8000-000000000240',
      ownerRole,
      'COMPANY',
      A.company,
      '2024-01-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.two,
      '01920000-0000-7000-8000-000000000241',
      ownerRole,
      'COMPANY',
      B.company,
      '2024-01-01T00:00:00Z',
      B.company,
    ),
  );
  await member(
    owner,
    at(
      U.drop,
      '01920000-0000-7000-8000-000000000250',
      ownerRole,
      'COMPANY',
      A.company,
      '2024-01-01T00:00:00Z',
    ),
  );
  await member(
    owner,
    at(
      U.drop,
      '01920000-0000-7000-8000-000000000251',
      ownerRole,
      'COMPANY',
      B.company,
      '2024-01-01T00:00:00Z',
      B.company,
    ),
  );
  await member(
    owner,
    at(
      U.explain,
      '01920000-0000-7000-8000-000000000260',
      ownerRole,
      'COMPANY',
      A.company,
      '2024-01-01T00:00:00Z',
    ),
  );
}

async function seedBulk(owner: postgres.Sql, ownerRole: string): Promise<void> {
  await owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    SELECT ${A.company}, gen_random_uuid(), ${U.bulk}, ${ownerRole}, 'global', 'COMPANY', ${A.company},
           '2024-01-01T00:00:00Z'::timestamptz
    FROM generate_series(1, 3000)`;
  await owner`ANALYZE memberships`;
}

async function seedMemberships(owner: postgres.Sql): Promise<void> {
  const ownerRole = OWNER_ROLE_ID;
  const cashier = roleId('cashier');
  await seedWindows(owner, ownerRole, cashier);
  await seedTies(owner, ownerRole, cashier);
  await seedCompanies(owner, ownerRole);
  await seedBulk(owner, ownerRole);
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seedUsers(owner);
    await seedMemberships(owner);
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

beforeEach(() => {
  seen.length = 0;
  omitted.clear();
  labels.clear();
});

describe('myWorkspaces', () => {
  it('returns no companies and does not ask for names when nothing is active', async () => {
    expect(await load(U.none)).toEqual({ companies: [] });
    expect(seen).toEqual([]);
  });

  it('drops an ended membership and one that has not started', async () => {
    const body = await load(U.window);
    expect(myWorkspacesResponse.parse(body)).toEqual(body);
    expect(body.companies).toEqual([
      expect.objectContaining({
        id: A.company,
        role_code: 'owner',
        scope: 'BRANCH',
        businesses: [],
      }),
    ]);
    expect(seen).toEqual([
      { companyId: A.company, scopes: [{ scope: 'BRANCH', scopeId: A.branch }] },
    ]);
  });

  it('keeps every scope and the role of the widest one', async () => {
    const body = await load(U.wide);
    expect(body.companies).toEqual([
      expect.objectContaining({ id: A.company, role_code: 'owner', scope: 'COMPANY' }),
    ]);
    expect(seen).toEqual([
      {
        companyId: A.company,
        scopes: [
          { scope: 'BRANCH', scopeId: A.branch },
          { scope: 'COMPANY', scopeId: A.company },
        ],
      },
    ]);
  });

  it('breaks an equal-width tie by the earliest start, then the smallest membership id', async () => {
    const byTime = await load(U.tieTime);
    expect(byTime.companies[0]).toMatchObject({ role_code: 'cashier', scope: 'BUSINESS' });
    seen.length = 0;
    const byId = await load(U.tieId);
    expect(byId.companies[0]).toMatchObject({ role_code: 'owner', scope: 'BRANCH' });
  });

  it('reads a company-owned role inside the tenant, and lists both companies by name_en then id', async () => {
    const owned = await load(U.owned);
    expect(owned.companies).toEqual([
      expect.objectContaining({ id: A.company, role_code: 'floor_lead', scope: 'COMPANY' }),
    ]);
    labels.set(A.company, 'Zulu');
    labels.set(B.company, 'Alpha');
    const both = await load(U.two);
    expect(myWorkspacesResponse.parse(both)).toEqual(both);
    expect(both.companies.map((company) => company.id)).toEqual([B.company, A.company]);
    expect(both.companies.map((company) => company.name_en)).toEqual(['Alpha', 'Zulu']);
  });
});

describe('myWorkspaces omissions and plan', () => {
  it('omits a company whose names come back empty and never names a company the user is not in', async () => {
    omitted.add(A.company);
    const body = await load(U.drop);
    expect(body.companies.map((company) => company.id)).toEqual([B.company]);
    expect(seen.map((call) => call.companyId)).toEqual([A.company, B.company]);
  });

  it('EXPLAIN ANALYZE looks up memberships by user id and never scans them sequentially', async () => {
    plans.length = 0;
    await myWorkspaces(explaining(db), names, U.explain);
    const plan = plans.find((entry) => entry.includes('memberships')) ?? '';
    expect(plan).toContain('memberships_user_id_idx');
    expect(plan).not.toContain('Seq Scan');
  });
});
