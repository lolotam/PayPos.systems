import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

// خدمات الكتالوج: عزل مفروض على مستوى قاعدة البيانات (ADR-0003 §2, ADR-0007)، والـ app مبيعملش حذف.
const { A, B } = TENANT;
const ID = '01920000-0000-7000-8000-0000000005e1';
let testDb: TestDatabase;
let db: Database;
let owner: postgres.Sql;

type RuleRow = {
  company_id: string;
  business_id: string;
  kind?: string;
  bps?: number | null;
  fixed?: string | null;
};

const insert = (row: RuleRow) => sql`
  INSERT INTO services (company_id, id, business_id, name_en, name_ar, price, commission_rule_kind,
    commission_pct_bps, commission_fixed_amount, counts_toward_threshold, revision, created_at, updated_at)
  VALUES (${row.company_id}, ${ID}, ${row.business_id}, 'Synthetic service', NULL, 12.500,
    ${row.kind ?? 'FOLLOW_PLAN'}, ${row.bps ?? null}, ${row.fixed ?? null}, true, 1, now(), now())
  RETURNING id`;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`INSERT INTO services (company_id, id, business_id, name_en, price, commission_rule_kind)
    VALUES (${B.company}, ${ID}, ${B.business}, 'Sentinel B', 1.000, 'ZERO')`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => ID } });
});

afterAll(async () => {
  await db.close();
  await owner.end();
  await testDb.drop();
});

const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));

async function rejectsWith(work: Promise<unknown>, expected: RegExp): Promise<void> {
  const error = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: unknown }).cause;
  expect(cause instanceof Error ? cause.message : (error as Error).message).toMatch(expected);
}

describe('services — forced tenant isolation and minimal grants', () => {
  it('enables and forces RLS; app owns no table and cannot bypass it', async () => {
    const [row] =
      await owner`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'services'::regclass`;
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const [role] =
      await owner`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pospay_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('A sees no B row and cannot insert under B or under a foreign business', async () => {
    expect(Array.from(await asA(sql`SELECT id FROM services`))).toEqual([]);
    await rejectsWith(
      asA(insert({ company_id: B.company, business_id: B.business })),
      /row-level security/,
    );
    // نفس الشركة لكن نشاط شركة تانية: الـ FK المركّب يرفض ومايكشفش النشاط.
    await rejectsWith(
      asA(insert({ company_id: A.company, business_id: B.business })),
      /services_business_fk/,
    );
  });

  it('the same id in A and B is allowed without an existence oracle', async () => {
    expect(
      Array.from(await asA(insert({ company_id: A.company, business_id: A.business }))),
    ).toEqual([{ id: ID }]);
    expect(Array.from(await asA(sql`SELECT name_en FROM services WHERE id = ${ID}`))).toEqual([
      { name_en: 'Synthetic service' },
    ]);
    expect(
      await owner`SELECT name_en FROM services WHERE company_id = ${B.company} AND id = ${ID}`,
    ).toEqual([{ name_en: 'Sentinel B' }]);
  });
});

describe('services — writes and database checks', () => {
  it('runtime cannot move a row to another company, reassign business or delete', async () => {
    await rejectsWith(
      asA(sql`UPDATE services SET company_id = ${B.company} WHERE id = ${ID}`),
      /permission denied/,
    );
    await rejectsWith(
      asA(sql`UPDATE services SET business_id = ${B.business} WHERE id = ${ID}`),
      /permission denied/,
    );
    await rejectsWith(
      asA(sql`DELETE FROM services WHERE company_id = ${A.company}`),
      /permission denied/,
    );
  });

  it('checks keep the commission rule columns mutually consistent', async () => {
    await rejectsWith(
      asA(insert({ company_id: A.company, business_id: A.business, kind: 'PCT', bps: 10_001 })),
      /services_rule_pct_bounds/,
    );
    await rejectsWith(
      asA(insert({ company_id: A.company, business_id: A.business, kind: 'ZERO', bps: 10 })),
      /services_rule_pct_present/,
    );
    await rejectsWith(
      asA(insert({ company_id: A.company, business_id: A.business, kind: 'FIXED' })),
      /services_rule_fixed_present/,
    );
    await rejectsWith(
      asA(insert({ company_id: A.company, business_id: A.business, kind: 'MIXED' })),
      /services_rule_kind/,
    );
  });

  it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
    'foreign runtime role %s has no access',
    async (url) => {
      const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
      try {
        await expect(role`SELECT id FROM services`).rejects.toThrow(/permission denied/);
      } finally {
        await role.end();
      }
    },
  );

  it('the creating migration has the company/business cursor index', async () => {
    const indexes =
      await owner`SELECT indexdef FROM pg_indexes WHERE tablename = 'services' ORDER BY indexname`;
    expect(indexes.map((r) => r['indexdef'])).toEqual(
      expect.arrayContaining([
        expect.stringContaining('services_company_business_id_idx'),
        expect.stringContaining('(company_id, business_id, id)'),
      ]),
    );
  });
});

it('A cannot update B, including through upsert; outside a tenant sees no services', async () => {
  expect(
    Array.from(
      await asA(sql`UPDATE services SET name_en='Synthetic overwrite'
    WHERE company_id=${B.company} AND id=${ID} RETURNING id`),
    ),
  ).toEqual([]);
  await rejectsWith(
    asA(sql`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${B.company},${ID},${B.business},'Synthetic upsert','0.000','ZERO')
    ON CONFLICT(company_id,id) DO UPDATE SET name_en=excluded.name_en`),
    /row-level security/,
  );
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    expect(await app`SELECT id FROM services`).toEqual([]);
  } finally {
    await app.end();
  }
});

it.each([
  ['price', 'NaN', 'services_price_nonnegative'],
  ['commission_fixed_amount', 'NaN', 'services_rule_fixed_nonnegative'],
  ['name_en', 'a\u0001b', 'services_name_en_controls'],
])('database refuses invalid %s', async (column, value, constraint) => {
  const rule = column === 'commission_fixed_amount' ? sql`,commission_rule_kind='FIXED'` : sql``;
  await rejectsWith(
    asA(sql`UPDATE services SET ${sql.identifier(column)}=${value} ${rule}
    WHERE company_id=${A.company} AND id=${ID}`),
    new RegExp(constraint),
  );
});
