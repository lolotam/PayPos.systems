import { myMembershipsResponse } from '@pospay/contracts';
import {
  createDatabase,
  SYSTEM_ROLES,
  type Database,
  type TenantWrappers,
  type Tx,
} from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { myMemberships } from '../my-memberships.query.ts';
import type { WorkspaceNames, WorkspaceScope } from '../my-workspaces.query.ts';

const { A, B } = TENANT;
const FLOOR = '01920000-0000-7000-8000-0000000000d1';
const CALLER = '01920000-0000-7000-8000-0000000000c1';
const OTHER = '01920000-0000-7000-8000-0000000000c2';
const EXPLAIN = '01920000-0000-7000-8000-0000000000c3';
const BULK = '01920000-0000-7000-8000-0000000000c4';
const BRANCH_MEMBER = '01920000-0000-7000-8000-0000000000c5';
const CUSTOM_MEMBER = '01920000-0000-7000-8000-0000000000c6';
const OTHER_MEMBER = '01920000-0000-7000-8000-0000000000c7';
const FOREIGN_MEMBER = '01920000-0000-7000-8000-0000000000c8';
const ENDED_MEMBER = '01920000-0000-7000-8000-0000000000c9';
const FUTURE_MEMBER = '01920000-0000-7000-8000-0000000000ca';
const EXPLAIN_MEMBER = '01920000-0000-7000-8000-0000000000cb';

const plans: string[] = [];

function roleId(code: string): string {
  const found = SYSTEM_ROLES.find((role) => role.code === code);
  if (found === undefined) throw new Error(`missing role ${code}`);
  return found.id;
}

const names: WorkspaceNames = {
  describe: async (tx, scopes: readonly WorkspaceScope[]) => {
    const [row] = Array.from(
      await tx.execute<{ id: string | null }>(sql`SELECT app_company_id() AS id`),
    );
    if (row?.id == null) throw new Error('workspace names were read outside withTenant');
    if (scopes.length === 0) return null;
    const here = row.id === A.company;
    return {
      id: row.id,
      name_ar: null,
      name_en: here ? 'Company A' : 'Company B',
      businesses: [
        {
          id: here ? A.business : B.business,
          name_ar: null,
          name_en: 'Clinic',
          branches: [
            {
              id: here ? A.branch : B.branch,
              name_ar: null,
              name_en: here ? 'Salmiya' : 'Other branch',
              effective_timezone: 'Asia/Kuwait',
              is_active: true,
            },
          ],
        },
      ],
    };
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
    withMember: (userId, companyId, fn) =>
      database.withMember(userId, companyId, (tx) => fn(explain(tx))),
    withTenant: (companyId, fn, options) =>
      database.withTenant(companyId, (tx) => fn(explain(tx)), options),
  };
}

type SeedRow = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string | null,
];

function openRows(branchRole: string): readonly SeedRow[] {
  return [
    [
      A.company,
      BRANCH_MEMBER,
      CALLER,
      branchRole,
      'global',
      'BRANCH',
      A.branch,
      '2024-01-01',
      null,
    ],
    [A.company, CUSTOM_MEMBER, CALLER, FLOOR, A.company, 'COMPANY', A.company, '2024-01-01', null],
    [A.company, OTHER_MEMBER, OTHER, branchRole, 'global', 'BRANCH', A.branch, '2024-01-01', null],
  ];
}

function closedRows(branchRole: string): readonly SeedRow[] {
  return [
    [
      B.company,
      FOREIGN_MEMBER,
      CALLER,
      branchRole,
      'global',
      'COMPANY',
      B.company,
      '2024-01-01',
      null,
    ],
    [
      A.company,
      ENDED_MEMBER,
      CALLER,
      branchRole,
      'global',
      'BRANCH',
      A.branch,
      '2020-01-01',
      '2020-02-01',
    ],
    [
      A.company,
      FUTURE_MEMBER,
      CALLER,
      branchRole,
      'global',
      'COMPANY',
      A.company,
      '2999-01-01',
      null,
    ],
    [
      A.company,
      EXPLAIN_MEMBER,
      EXPLAIN,
      branchRole,
      'global',
      'COMPANY',
      A.company,
      '2024-01-01',
      null,
    ],
  ];
}

async function seed(owner: postgres.Sql): Promise<void> {
  for (const userId of [CALLER, OTHER, EXPLAIN, BULK]) {
    await owner`INSERT INTO "user" (id, name, email) VALUES (${userId}, 'U', ${`${userId}@example.test`})`;
  }
  await owner`
    INSERT INTO roles (id, company_id, code, name_en)
    VALUES (${FLOOR}, ${A.company}, 'floor_lead', 'Floor lead')`;
  const branchRole = roleId('branch_manager');
  const rows = [...openRows(branchRole), ...closedRows(branchRole)];
  for (const [company, id, user, role, ownerKey, scope, scopeId, starts, ends] of rows) {
    await owner`
      INSERT INTO memberships (
        company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at, ends_at
      ) VALUES (
        ${company}, ${id}, ${user}, ${role}, ${ownerKey}, ${scope}, ${scopeId},
        ${starts}::timestamptz, ${ends}::timestamptz
      )`;
  }
  await owner`
    INSERT INTO memberships (
      company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at
    )
    SELECT ${A.company}, gen_random_uuid(), ${BULK}, ${branchRole}, 'global', 'COMPANY', ${A.company},
           '2024-01-01T00:00:00Z'::timestamptz
    FROM generate_series(1, 3000)`;
  await owner`ANALYZE memberships`;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await seed(owner);
  } finally {
    await owner.end();
  }
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

describe('myMemberships', () => {
  it('returns the caller role and scope names, including a company-owned role', async () => {
    const body = myMembershipsResponse.parse(await myMemberships(db, names, CALLER, A.company));
    expect(body.items).toEqual([
      {
        id: BRANCH_MEMBER,
        role_code: 'branch_manager',
        role_is_system: true,
        role_name_ar: null,
        role_name_en: 'Branch Manager',
        scope_type: 'BRANCH',
        scope_id: A.branch,
        scope_name_ar: null,
        scope_name_en: 'Salmiya',
      },
      {
        id: CUSTOM_MEMBER,
        role_code: 'floor_lead',
        role_is_system: false,
        role_name_ar: null,
        role_name_en: 'Floor lead',
        scope_type: 'COMPANY',
        scope_id: A.company,
        scope_name_ar: null,
        scope_name_en: 'Company A',
      },
    ]);
  });

  it('keeps another user, another company, and a closed window out of the list', async () => {
    const here = await myMemberships(db, names, CALLER, A.company);
    const there = await myMemberships(db, names, CALLER, B.company);
    expect(here.items.map((membership) => membership.id)).toEqual([BRANCH_MEMBER, CUSTOM_MEMBER]);
    expect(there.items.map((membership) => membership.id)).toEqual([FOREIGN_MEMBER]);
    expect(JSON.stringify(here)).not.toContain(OTHER_MEMBER);
    expect(JSON.stringify(there)).not.toContain(BRANCH_MEMBER);
  });

  it('EXPLAIN ANALYZE looks up memberships by index and never scans them sequentially', async () => {
    plans.length = 0;
    await myMemberships(explaining(db), names, EXPLAIN, A.company);
    const plan = plans.find((entry) => entry.includes('memberships')) ?? '';
    expect(plan).toMatch(/memberships_(user_id_idx|company_id_user_id_id_key)/);
    expect(plan).not.toContain('Seq Scan');
  });
});
