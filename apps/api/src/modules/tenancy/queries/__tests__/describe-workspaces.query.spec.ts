import { workspaceCompanyNames, type WorkspaceCompanyNames } from '@pospay/contracts';
import { createDatabase, PROVISIONAL_PLAN_ID, type Database } from '@pospay/db';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { explaining } from '../../../../../test/explaining.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../../packages/db/test/tenancy-fixtures.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../../packages/db/test/test-database.ts';
import { describeWorkspaces, type WorkspaceScope } from '../describe-workspaces.query.ts';

// CLAUDE.md §9: the workspace read has a result-shape test and an EXPLAIN ANALYZE assertion on a seeded dataset.
const { A, B } = TENANT;
const ALPHA = '01920000-0000-7000-8000-0000000000a3';
const NORTH = '01920000-0000-7000-8000-0000000000a4';
const EAST = '01920000-0000-7000-8000-0000000000a5';
const EMPTY = '01920000-0000-7000-8000-0000000000a6';
const CLOSED = '01920000-0000-7000-8000-0000000000a7';

const alpha = {
  id: ALPHA,
  name_ar: null,
  name_en: 'Alpha',
  business_type: 'retail' as const,
  country: 'KW' as const,
  branches: [
    {
      id: CLOSED,
      name_ar: null,
      name_en: 'Closed',
      effective_timezone: 'Asia/Kuwait',
      is_active: false,
    },
    {
      id: NORTH,
      name_ar: null,
      name_en: 'North',
      effective_timezone: 'Asia/Riyadh',
      is_active: true,
    },
  ],
};
const emptyBusiness = {
  id: EMPTY,
  name_ar: null,
  name_en: 'Empty',
  business_type: 'restaurant' as const,
  country: null,
  branches: [],
};
const east = {
  id: EAST,
  name_ar: null,
  name_en: 'East',
  effective_timezone: 'Asia/Qatar',
  is_active: true,
};
const west = {
  id: A.branch,
  name_ar: null,
  name_en: 'West',
  effective_timezone: 'Asia/Qatar',
  is_active: true,
};
const zed = {
  id: A.business,
  name_ar: 'زيد',
  name_en: 'Zed',
  business_type: 'salon' as const,
  country: null,
  branches: [east, west],
};
// كل نشاط بيرجع أوسع وصول اليوزر عليه: عضوية على الشركة، أو على النشاط نفسه، أو عن طريق فرع.
const scoped = (
  businesses: WorkspaceCompanyNames['businesses'],
  scope: WorkspaceScope['scope'],
): WorkspaceCompanyNames['businesses'] => businesses.map((business) => ({ ...business, scope }));
const companyA = {
  id: A.company,
  name_ar: 'شركة أ',
  name_en: 'Company A',
  businesses: scoped([alpha, emptyBusiness, zed], 'COMPANY'),
};

let testDb: TestDatabase;
let db: Database;
const plans: string[] = [];

function read(companyId: string, scopes: readonly WorkspaceScope[]) {
  return db.withTenant(companyId, (tx) => describeWorkspaces(tx, scopes), { userId: USER });
}

async function seedVolume(ownerUrl: string): Promise<void> {
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`
      INSERT INTO companies (id, name_en, owner_user_id, plan_id)
      SELECT gen_random_uuid(), 'Bulk ' || n, ${USER}, ${PROVISIONAL_PLAN_ID}
      FROM generate_series(1, 800) AS n`;
    await owner`
      INSERT INTO businesses (id, company_id, vertical_type, name_en)
      SELECT gen_random_uuid(), c.id, 'retail', 'Shop ' || s
      FROM (SELECT id FROM companies WHERE name_en LIKE 'Bulk %' LIMIT 40) AS c
      CROSS JOIN generate_series(1, 15) AS s`;
    await owner`
      INSERT INTO branches (id, company_id, business_id, name_en)
      SELECT gen_random_uuid(), b.company_id, b.id, 'Desk ' || s
      FROM businesses b
      CROSS JOIN generate_series(1, 3) AS s
      WHERE b.name_en LIKE 'Shop %'`;
    await owner`ANALYZE companies, businesses, branches`;
  } finally {
    await owner.end();
  }
}

async function shapeCompanyA(ownerUrl: string): Promise<void> {
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`UPDATE companies SET name_ar = 'شركة أ' WHERE id = ${A.company}`;
    await owner`
      UPDATE businesses
      SET name_en = 'Zed', name_ar = 'زيد', timezone = 'Asia/Qatar',
          settings = '{"country": "XX"}'::jsonb
      WHERE company_id = ${A.company} AND id = ${A.business}`;
    await owner`
      UPDATE branches SET name_en = 'West', timezone = NULL
      WHERE company_id = ${A.company} AND id = ${A.branch}`;
    await owner`
      INSERT INTO businesses (id, company_id, vertical_type, name_en, timezone, settings)
      VALUES (${ALPHA}, ${A.company}, 'retail', 'Alpha', 'Asia/Kuwait', '{"country": "KW"}'::jsonb),
             (${EMPTY}, ${A.company}, 'restaurant', 'Empty', 'Asia/Kuwait', '{}'::jsonb)`;
    await owner`
      INSERT INTO branches (id, company_id, business_id, name_en, timezone, is_active)
      VALUES (${NORTH}, ${A.company}, ${ALPHA}, 'North', 'Asia/Riyadh', true),
             (${CLOSED}, ${A.company}, ${ALPHA}, 'Closed', NULL, false),
             (${EAST}, ${A.company}, ${A.business}, 'East', NULL, true)`;
  } finally {
    await owner.end();
  }
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  await seedVolume(testDb.ownerUrl);
  await shapeCompanyA(testDb.ownerUrl);
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => A.company } });
});

afterAll(async () => {
  await db.close();
  await testDb.drop();
});

const company = [{ scope: 'COMPANY' as const, scopeId: A.company }];

describe('describeWorkspaces', () => {
  it('returns the company tree in the contract shape, including an inactive branch and an empty business', async () => {
    const tree = await read(A.company, company);
    expect(workspaceCompanyNames.parse(tree)).toEqual(tree);
    expect(tree).toEqual(companyA);
  });

  it('a BUSINESS scope sees that business and only its branches', async () => {
    const tree = await read(A.company, [{ scope: 'BUSINESS', scopeId: A.business }]);
    expect(tree).toEqual({ ...companyA, businesses: scoped([zed], 'BUSINESS') });
  });

  it('a BUSINESS scope with no branches still returns the business', async () => {
    const tree = await read(A.company, [{ scope: 'BUSINESS', scopeId: EMPTY }]);
    expect(tree).toEqual({ ...companyA, businesses: scoped([emptyBusiness], 'BUSINESS') });
  });

  it('a BRANCH scope sees that branch and its parent business, not siblings', async () => {
    const tree = await read(A.company, [{ scope: 'BRANCH', scopeId: A.branch }]);
    expect(tree).toEqual({
      ...companyA,
      businesses: scoped([{ ...zed, branches: [west] }], 'BRANCH'),
    });
  });

  it('tells each business how the user reaches it: a business membership is BUSINESS, a branch-only business is BRANCH', async () => {
    const tree = await read(A.company, [
      { scope: 'BUSINESS', scopeId: A.business },
      { scope: 'BRANCH', scopeId: NORTH },
    ]);
    expect(tree?.businesses.map((business) => [business.id, business.scope])).toEqual([
      [ALPHA, 'BRANCH'],
      [A.business, 'BUSINESS'],
    ]);
  });

  it('overlapping scopes do not duplicate a business or a branch', async () => {
    const tree = await read(A.company, [
      { scope: 'COMPANY', scopeId: A.company },
      { scope: 'BRANCH', scopeId: A.branch },
    ]);
    expect(tree).toEqual(companyA);
  });

  it('scopes that name another company still return only this company', async () => {
    const pointedAtB = await read(A.company, [{ scope: 'BRANCH', scopeId: B.branch }]);
    expect(pointedAtB).toEqual({ ...companyA, businesses: [] });
    const companyScopeOfB = await read(A.company, [{ scope: 'COMPANY', scopeId: B.company }]);
    expect(companyScopeOfB).toEqual(companyA);
    const otherTenant = await read(B.company, [{ scope: 'COMPANY', scopeId: B.company }]);
    expect(otherTenant).toMatchObject({ id: B.company, name_en: 'Company B' });
    expect(JSON.stringify(otherTenant)).not.toContain(A.company);
    expect(JSON.stringify(pointedAtB)).not.toContain('Company B');
  });

  it('a closed company and an empty scope list return nothing', async () => {
    expect(await read(A.company, [])).toBeNull();
    const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
    try {
      await owner`UPDATE companies SET deleted_at = now() WHERE id = ${A.company}`;
      expect(await read(A.company, company)).toBeNull();
    } finally {
      await owner`UPDATE companies SET deleted_at = NULL WHERE id = ${A.company}`;
      await owner.end();
    }
  });
});

describe('describeWorkspaces legacy country normalization', () => {
  it.each([
    ['lowercase country', '{"country": "kw"}'],
    ['numeric country', '{"country": 965}'],
    ['array country', '{"country": ["KW"]}'],
    ['non-object array settings', '["KW"]'],
    ['non-object scalar settings', '"KW"'],
  ])('maps legacy malformed stored country (%s) to null without failing', async (_label, raw) => {
    const owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
    try {
      await owner`
        UPDATE businesses SET settings = ${raw}::jsonb
        WHERE company_id = ${A.company} AND id = ${EMPTY}`;
      const tree = await read(A.company, [{ scope: 'BUSINESS', scopeId: EMPTY }]);
      expect(workspaceCompanyNames.parse(tree)).toEqual(tree);
      expect(tree).toEqual({ ...companyA, businesses: scoped([emptyBusiness], 'BUSINESS') });
    } finally {
      await owner`
        UPDATE businesses SET settings = '{}'::jsonb
        WHERE company_id = ${A.company} AND id = ${EMPTY}`;
      await owner.end();
    }
  });
});

describe('describeWorkspaces plan', () => {
  it('EXPLAIN ANALYZE uses the tenant indexes, never scans sequentially, and stays at two statements', async () => {
    plans.length = 0;
    await explaining(db, plans).withTenant(A.company, (tx) => describeWorkspaces(tx, company), {
      userId: USER,
    });
    expect(plans).toHaveLength(2);
    const plan = plans.at(-1) ?? '';
    expect(plan).toContain('companies_pkey');
    expect(
      plan.includes('businesses_pkey') || plan.includes('businesses_company_id_created_at_idx'),
    ).toBe(true);
    expect(
      plan.includes('branches_pkey') || plan.includes('branches_company_id_business_id_idx'),
    ).toBe(true);
    expect(plan).not.toContain('Seq Scan');
  });
});
