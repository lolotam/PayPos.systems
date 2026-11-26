import type { PackageTypeDetail } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  listSellablePackageTypes,
  sellablePackageTypesStatement,
} from '../queries/sellable-package-types.query.ts';
import { packageTypesFixture, packageTerms, type PackageFixture } from './package-types.fixture.ts';

const ids = systemUuidV7();
let f: PackageFixture;
let branch: string;
let secondBranch: string;
let foreignBranch: string;
let active: PackageTypeDetail[];
let stopped: PackageTypeDetail;
let secondBusinessType: PackageTypeDetail;
let foreignType: PackageTypeDetail;

beforeAll(async () => {
  f = await packageTypesFixture();
  branch = ids.newId();
  secondBranch = ids.newId();
  foreignBranch = ids.newId();
  await f.h.owner`INSERT INTO branches(company_id,id,business_id,name_en) VALUES
    (${f.company},${branch},${f.business},'Synthetic sale branch'),
    (${f.company},${secondBranch},${f.secondBusiness},'Synthetic second business branch'),
    (${f.otherCompany},${foreignBranch},${f.foreignBusiness},'Synthetic foreign branch')`;
  active = [];
  for (const name of ['Mixed quote', 'Second page', 'Third page']) {
    const components =
      name === 'Mixed quote'
        ? [
            { service_id: f.services[1]?.id ?? '', sessions: 2 },
            { service_id: f.services[0]?.id ?? '', sessions: 1 },
          ]
        : packageTerms(f, name).components;
    active.push(
      await f.createPackage.execute({
        companyId: f.company,
        userId: f.userId,
        businessId: f.business,
        input: { ...packageTerms(f, name), components },
      }),
    );
  }
  stopped = await f.createPackage.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: packageTerms(f, 'Stopped'),
  });
  await f.h
    .owner`UPDATE package_types SET selling_stopped_at=now() WHERE company_id=${f.company} AND id=${stopped.id}`;
  secondBusinessType = await outsidePackage(
    f.company,
    f.secondBusiness,
    'Same company other business',
  );
  foreignType = await outsidePackage(f.otherCompany, f.foreignBusiness, 'Foreign company');
});

afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function outsidePackage(companyId: string, businessId: string, name: string) {
  const service = await f.create.execute({
    companyId,
    businessId,
    userId: f.userId,
    input: {
      name_en: `${name} service`,
      name_ar: null,
      price: '4.250',
      commission_rule: { kind: 'ZERO' },
    },
  });
  return f.createPackage.execute({
    companyId,
    businessId,
    userId: f.userId,
    input: { ...packageTerms(f, name), components: [{ service_id: service.id, sessions: 3 }] },
  });
}

function quote(record: PackageTypeDetail) {
  return {
    id: record.id,
    revision: record.revision,
    name_en: record.name_en,
    name_ar: record.name_ar,
    price: record.price,
    validity_days: record.validity_days,
    components: record.components.map((entry) => ({
      service_id: entry.service_id,
      service_revision: 1,
      name_en: entry.name_en,
      name_ar: entry.name_ar,
      sessions: entry.sessions,
      list_price: entry.price,
    })),
  };
}

const list = (limit: number, cursor?: string, businessId = f.business, companyId = f.company) =>
  f.db.withTenant(companyId, (tx) =>
    listSellablePackageTypes(tx, companyId, businessId, {
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    }),
  );

it('projects exact quote fields in component position order and omits stopped/other-business types', async () => {
  const page = await list(20);
  expect(page).toEqual({ items: active.map(quote), next_cursor: null });
  expect(page.items[0]?.components.map((entry) => entry.service_id)).toEqual([
    f.services[1]?.id,
    f.services[0]?.id,
  ]);
  expect(page.items.some((entry) => entry.id === stopped.id)).toBe(false);
  expect(page.items.some((entry) => entry.id === secondBusinessType.id)).toBe(false);
  expect(page.items.some((entry) => entry.id === foreignType.id)).toBe(false);
});

it('continues a keyset cursor without gaps or duplicates', async () => {
  const first = await list(2);
  expect(first).toEqual({ items: active.slice(0, 2).map(quote), next_cursor: active[1]?.id });
  expect(await list(2, first.next_cursor ?? undefined)).toEqual({
    items: active.slice(2).map(quote),
    next_cursor: null,
  });
});

it('isolates a foreign tenant and same-company foreign business at the catalog boundary', async () => {
  expect((await list(20, undefined, f.secondBusiness)).items).toEqual([quote(secondBusinessType)]);
  expect((await list(20, undefined, f.foreignBusiness, f.otherCompany)).items).toEqual([
    quote(foreignType),
  ]);
  const leaked = await f.db.withTenant(f.company, (tx) =>
    listSellablePackageTypes(tx, f.otherCompany, f.foreignBusiness, { limit: 20 }),
  );
  expect(leaked).toEqual({ items: [], next_cursor: null });
});

it('uses tenant/component indexes for first and subsequent pages', async () => {
  for (const cursor of [undefined, active[0]?.id]) {
    const plan = await f.db.withTenant(f.company, async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan=off`);
      return tx.execute(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${sellablePackageTypesStatement(f.company, f.business, {
          limit: 2,
          ...(cursor === undefined ? {} : { cursor }),
        })}`,
      );
    });
    expect(JSON.stringify(plan)).toMatch(
      /package_types_(active_business_id_idx|company_business_id_key|pkey)/,
    );
    expect(JSON.stringify(plan)).toMatch(/package_type_components_type_(idx|position_key)/);
  }
});

it('hides a package type whose component service is closed and restores it when reopened (SI-Q28)', async () => {
  const target = active[0];
  const serviceId = f.services[1]?.id ?? '';
  await f.h
    .owner`UPDATE services SET closed_at=now() WHERE company_id=${f.company} AND id=${serviceId}`;
  try {
    const ids = (await list(20)).items.map((entry) => entry.id);
    expect(ids).not.toContain(target?.id);
    expect(ids).toEqual(expect.arrayContaining(active.slice(1).map((entry) => entry.id)));
  } finally {
    await f.h
      .owner`UPDATE services SET closed_at=NULL WHERE company_id=${f.company} AND id=${serviceId}`;
  }
  expect((await list(20)).items.map((entry) => entry.id)).toContain(target?.id);
});
