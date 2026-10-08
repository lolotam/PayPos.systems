import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  listPackageTypes,
  listPackageTypesStatement,
} from '../queries/list-package-types.query.ts';
import {
  getPackageTypeDetail,
  packageTypeDetailStatement,
} from '../queries/package-type-detail.query.ts';
import { packageTypesFixture, packageTerms, type PackageFixture } from './package-types.fixture.ts';

let f: PackageFixture;
let records: Awaited<ReturnType<PackageFixture['createPackage']['execute']>>[];

beforeAll(async () => {
  f = await packageTypesFixture();
  records = [];
  for (let i = 0; i < 150; i++) {
    records.push(
      await f.createPackage.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        input: packageTerms(f, `Package ${i}`),
      }),
    );
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const list = (limit: number, cursor?: string, company = f.company, business = f.business) =>
  f.db.withTenant(company, (tx) =>
    listPackageTypes(tx, company, business, { limit, ...(cursor ? { cursor } : {}) }),
  );

it('lists exact DTO projections with stable cursor pages and no duplicate rows', async () => {
  const first = await list(2);
  expect(first.items).toEqual(
    records.slice(0, 2).map((record) => ({
      id: record.id,
      name_en: record.name_en,
      name_ar: record.name_ar,
      price: record.price,
      validity_days: record.validity_days,
      component_count: record.components.length,
      revision: record.revision,
    })),
  );
  expect(first.next_cursor).toBe(records[1]?.id);
  expect(await list(1, first.next_cursor ?? undefined)).toEqual({
    items: [
      {
        id: records[2]?.id,
        name_en: records[2]?.name_en,
        name_ar: records[2]?.name_ar,
        price: records[2]?.price,
        validity_days: records[2]?.validity_days,
        component_count: records[2]?.components.length,
        revision: records[2]?.revision,
      },
    ],
    next_cursor: records[2]?.id,
  });
});

it('pages all 150 types without duplicates or writes', async () => {
  const auditBefore = await f.h.owner`SELECT count(*) FROM audit_log`;
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list(40, cursor);
    ids.push(...page.items.map((row) => row.id));
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined && ids.length <= 150);
  expect(cursor).toBeUndefined();
  expect(ids).toEqual(records.map((record) => record.id));
  expect(new Set(ids).size).toBe(150);
  expect(await f.h.owner`SELECT count(*) FROM audit_log`).toEqual(auditBefore);
});

it('isolates another company and another business', async () => {
  expect(await list(20, undefined, f.otherCompany)).toEqual({ items: [], next_cursor: null });
  expect(await list(20, undefined, f.company, f.secondBusiness)).toEqual({
    items: [],
    next_cursor: null,
  });
});

it('the list plan uses tenant-scoped indexes for cursor rows and component counts', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listPackageTypesStatement(f.company, f.business, { limit: 20 })}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/package_types_(company_business_id_key|pkey)/);
  expect(JSON.stringify(plan)).toMatch(/package_type_components_type_(idx|position_key)/);
});

it('the detail projection matches the contract and uses a tenant-scoped index', async () => {
  const record = records[0];
  if (record === undefined) throw new Error('Synthetic package fixture missing');
  const result = await f.db.withTenant(f.company, (tx) =>
    getPackageTypeDetail(tx, f.company, f.business, record.id),
  );
  expect(result).toEqual(record);
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${packageTypeDetailStatement(f.company, f.business, record.id)}`,
    );
  });
  expect(JSON.stringify(plan)).toMatch(/package_types_(company_business_id|pk|name_en_key)/);
});
