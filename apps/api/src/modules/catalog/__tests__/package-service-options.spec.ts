import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  listPackageServiceOptions,
  packageServiceOptionsStatement,
} from '../queries/package-service-options.query.ts';
import { servicesFixture, termsFor, type ServiceFixture } from './services.fixture.ts';

let f: ServiceFixture;
let records: Awaited<ReturnType<ServiceFixture['create']['execute']>>[];

beforeAll(async () => {
  f = await servicesFixture();
  records = [];
  for (const name of ['Alpha', 'Bravo', 'Charlie']) {
    records.push(
      await f.create.execute({
        companyId: f.company,
        businessId: f.business,
        userId: f.userId,
        input: { ...termsFor(name), price: name === 'Alpha' ? '0.000' : '12.500' },
      }),
    );
  }
  for (const [companyId, businessId] of [
    [f.company, f.secondBusiness],
    [f.otherCompany, f.foreignBusiness],
  ] as const) {
    await f.create.execute({ companyId, businessId, userId: f.userId, input: termsFor('Outside') });
  }
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const list = (limit: number, cursor?: string) =>
  f.db.withTenant(f.company, (tx) =>
    listPackageServiceOptions(tx, f.company, f.business, {
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );

it('projects only picker fields and preserves exact prices through stable cursor pages', async () => {
  const expected = records.map(({ id, name_ar, name_en, price }) => ({
    id,
    name_ar,
    name_en,
    price,
    active: true,
  }));
  const first = await list(2);
  expect(first).toEqual({ items: expected.slice(0, 2), next_cursor: records[1]?.id });
  expect(await list(2, first.next_cursor ?? undefined)).toEqual({
    items: expected.slice(2),
    next_cursor: null,
  });
  const raw = await f.db.withTenant(f.company, (tx) =>
    tx.execute(packageServiceOptionsStatement(f.company, f.business, { limit: 20 })),
  );
  expect(Array.from(raw)).toEqual(expected);
});

it('isolates tenants even with a mismatched company predicate, and excludes other businesses', async () => {
  for (const [companyId, businessId] of [
    [f.company, f.foreignBusiness],
    [f.otherCompany, f.foreignBusiness],
  ] as const) {
    expect(
      await f.db.withTenant(f.company, (tx) =>
        listPackageServiceOptions(tx, companyId, businessId, { limit: 20 }),
      ),
    ).toEqual({ items: [], next_cursor: null });
  }
  const second = await f.db.withTenant(f.company, (tx) =>
    listPackageServiceOptions(tx, f.company, f.secondBusiness, { limit: 20 }),
  );
  expect(second.items).toHaveLength(1);
  expect(second.items[0]?.name_en).toBe('Outside');
});

it('uses the existing company/business/id index for the first and subsequent pages', async () => {
  for (const cursor of [undefined, records[0]?.id]) {
    const plan = await f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      return tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${packageServiceOptionsStatement(f.company, f.business, {
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        })}`,
      );
    });
    expect(JSON.stringify(plan)).toContain('services_company_business_id_key');
  }
});
