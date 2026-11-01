import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@pospay/db';
import { PgDialect } from 'drizzle-orm/pg-core';
import { catalogReader } from '../persistence/catalog-reader.adapter.ts';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
const packageType = ids.newId();
const otherService = ids.newId();
const otherPackageType = ids.newId();

beforeAll(async () => {
  f = await sessionFixture();
  await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES(${f.company},${packageType},${f.business},'Synthetic package','30.000',90)`;
  await f.h
    .owner`INSERT INTO package_type_components(company_id,id,package_type_id,business_id,service_id,sessions,position)
    VALUES(${f.company},${ids.newId()},${packageType},${f.business},${must(f.services[1])},3,1),
      (${f.company},${ids.newId()},${packageType},${f.business},${must(f.services[0])},5,2)`;
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${otherService},${f.secondBusiness},'Synthetic other service','10.000','ZERO')`;
  await f.h.owner`INSERT INTO package_types(company_id,id,business_id,name_en,price,validity_days)
    VALUES(${f.company},${otherPackageType},${f.secondBusiness},'Synthetic other package','15.000',30)`;
  await f.h
    .owner`INSERT INTO package_type_components(company_id,id,package_type_id,business_id,service_id,sessions,position)
    VALUES(${f.company},${ids.newId()},${otherPackageType},${f.secondBusiness},${otherService},2,1)`;
});
afterAll(async () => {
  await f?.close();
});

const read = (packageTypeId: string) =>
  f.db.withTenant(f.company, (tx) =>
    catalogReader(tx, f.company, f.business).readPackageTypeForSale(packageTypeId),
  );

it('returns the package type with its components in position order and every service snapshot', async () => {
  const type = await read(packageType);
  expect(type?.price).toBe(30000n);
  expect(type?.validity_days).toBe(90);
  expect(type?.revision).toBe(1);
  expect(type?.components.map((component) => component.service_id)).toEqual([
    must(f.services[1]),
    must(f.services[0]),
  ]);
  expect(type?.components.map((component) => component.sessions)).toEqual([3, 5]);
  expect(type?.components.map((component) => component.position)).toEqual([1, 2]);
  expect(type?.components[0]?.service).toMatchObject({
    id: must(f.services[1]),
    price: 7125n,
    rule: { kind: 'PCT', value: 1000 },
  });
  expect(type?.components[1]?.service).toMatchObject({
    id: must(f.services[0]),
    price: 25000n,
    rule: { kind: 'FOLLOW_PLAN' },
  });
});

it('returns null for a type of another business and for an unknown id', async () => {
  expect(await read(otherPackageType)).toBeNull();
  expect(await read(ids.newId())).toBeNull();
});

it('holds the package type and its component services until the selling transaction ends', async () => {
  const lockPackageType = () =>
    f.h
      .owner`SELECT 1 FROM package_types WHERE company_id=${f.company} AND id=${packageType} FOR UPDATE NOWAIT`;
  const lockService = () =>
    f.h
      .owner`SELECT 1 FROM services WHERE company_id=${f.company} AND id=${must(f.services[1])} FOR UPDATE NOWAIT`;
  await f.db.withTenant(f.company, async (tx) => {
    await catalogReader(tx, f.company, f.business).readPackageTypeForSale(packageType);
    await expect(lockPackageType()).rejects.toMatchObject({ code: '55P03' });
    await expect(lockService()).rejects.toMatchObject({ code: '55P03' });
  });
  await expect(lockPackageType()).resolves.toBeDefined();
  await expect(lockService()).resolves.toBeDefined();
});

it('plans the package type and its component read as index scans', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const statements: SQL[] = [];
    const proxy = new Proxy(tx, {
      get: (target, prop, receiver) =>
        prop === 'execute'
          ? (query: SQL) => {
              statements.push(query);
              return target.execute(query);
            }
          : Reflect.get(target, prop, receiver),
    }) as Tx;
    await catalogReader(proxy, f.company, f.business).readPackageTypeForSale(packageType);
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const dialect = new PgDialect();
    const reads = statements.filter((s) =>
      /FROM package_types|FROM package_type_components/.test(dialect.sqlToQuery(s).sql),
    );
    expect(reads).toHaveLength(2);
    for (const query of reads) {
      const plan = await tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON) ${query}`);
      expect(JSON.stringify(plan)).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    }
  });
});
