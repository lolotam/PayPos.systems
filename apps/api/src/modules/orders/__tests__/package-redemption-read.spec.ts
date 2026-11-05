import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Tx } from '@pospay/db';
import { moneyToString } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  ids,
  must,
  sessionFixture,
  type SessionFixture,
} from '../../../../test/service-session.fixture.ts';
import {
  lockPackageRedemptionComponents,
  readPackageRedemptionFreeSlots,
  type PackageRedemptionScope,
} from '../persistence/package-redemption-read.ts';

let f: SessionFixture;
const entitlement = ids.newId();
const foreignEntitlement = ids.newId();
const otherBusinessEntitlement = ids.newId();
const otherService = ids.newId();
const components = [ids.newId(), ids.newId(), ids.newId()].sort();
const foreignComponent = ids.newId();
let scope: PackageRedemptionScope;

beforeAll(async () => {
  f = await sessionFixture();
  scope = { companyId: f.company, businessId: f.business, customerId: f.customer };
  await seed(scope, entitlement, components, f.services);
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.company},${otherService},${f.secondBusiness},'Synthetic other service',1.000,'ZERO')`;
  await seed(
    { ...scope, businessId: f.secondBusiness },
    otherBusinessEntitlement,
    [ids.newId()],
    [otherService],
  );
  const customer = ids.newId();
  const service = ids.newId();
  await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES(${f.otherCompany},${customer},'Synthetic foreign customer','+999999997123','en',now(),now())`;
  await f.h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES(${f.otherCompany},${service},${f.foreignBusiness},'Synthetic foreign service',1.000,'ZERO')`;
  await seed(
    { companyId: f.otherCompany, businessId: f.foreignBusiness, customerId: customer },
    foreignEntitlement,
    [foreignComponent],
    [service],
  );
});

afterAll(async () => {
  await f?.close();
});

async function seed(
  target: PackageRedemptionScope,
  entitlementId: string,
  componentIds: readonly string[],
  services: readonly string[],
): Promise<void> {
  const file = ids.newId();
  const preview = ids.newId();
  const memberships = await f.h.owner`SELECT id FROM memberships
    WHERE company_id=${target.companyId} AND user_id=${f.userId} LIMIT 1`;
  const membership = must(memberships[0])['id'] as string;
  await f.h.owner`INSERT INTO file_objects(company_id,id,business_id,owner_module,owner_entity_id,
    staging_key,content_type,size_bytes,required_permission,created_by,created_at)
    VALUES(${target.companyId},${file},${target.businessId},'import',${file},${file},
    'application/pdf',10,'read:files:business',${f.userId},now())`;
  await f.h.owner`INSERT INTO import_previews(company_id,id,business_id,entity,file_id,created_by,
    created_at,expires_at,row_count,error_count,rows,errors)
    VALUES(${target.companyId},${preview},${target.businessId},'packages',${file},${f.userId},
    now(),now()+interval '1 day',1,0,'[]'::jsonb,'[]'::jsonb)`;
  await f.db.withTenant(target.companyId, async (tx) => {
    await tx.execute(sql`INSERT INTO package_entitlements(company_id,id,business_id,customer_id,
      provenance,name_en,price_paid,recorded_by,recorded_by_membership_id,external_ref,
      import_batch_id,import_row,expires_on)
      VALUES(${target.companyId},${entitlementId},${target.businessId},${target.customerId},
      'IMPORTED','Synthetic package',${moneyToString(BigInt(componentIds.length) * 365000n + 365n)},${f.userId},
      ${membership},${entitlementId},${preview},1,'2026-12-30')`);
    for (const [index, componentId] of componentIds.entries()) {
      await tx.execute(sql`INSERT INTO package_components(company_id,id,business_id,entitlement_id,
        service_id,position,name_en,list_price_snapshot,sessions_total,component_value)
        VALUES(${target.companyId},${componentId},${target.businessId},${entitlementId},
        ${must(services[index])},${index + 1},'Synthetic component',1.000,365,
        ${index === 0 ? '365.365' : '365.000'})`);
    }
    for (const [index, componentId] of componentIds.entries()) {
      await tx.execute(sql`INSERT INTO package_session_slots(company_id,id,business_id,
        entitlement_id,component_id,ordinal,unit_value,state)
        SELECT ${target.companyId}::uuid, gen_random_uuid(),${target.businessId}::uuid,
        ${entitlementId}::uuid,${componentId}::uuid,n,
        CASE WHEN n=2 AND ${index}=0 THEN 1.365 ELSE 1.000 END,
        CASE WHEN n=1 THEN 'IMPORTED_USED' ELSE 'FREE' END
        FROM generate_series(1,365) n`);
    }
  });
}

const pairs = () =>
  [0, 1].map((index) => ({ entitlementId: entitlement, serviceId: must(f.services[index]) }));

it('returns scoped snapshots in input order, preserving repeated components', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const request = [must(pairs()[1]), must(pairs()[0]), must(pairs()[1])];
    const result = must(await lockPackageRedemptionComponents(tx, scope, request));
    expect(result.map((row) => row.componentId)).toEqual([
      components[1],
      components[0],
      components[1],
    ]);
    expect(result[0]).toEqual({
      ...scope,
      entitlementId: entitlement,
      componentId: components[1],
      serviceId: f.services[1],
      expiresOn: '2026-12-30',
      soldAt: null,
      provenance: 'IMPORTED',
    });
  });
});

it('uses one ordered lock statement for distinct components and rereads after locking', async () => {
  const statements: string[] = [];
  const dialect = new PgDialect();
  await f.db.withTenant(f.company, async (tx) => {
    const observed = new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== 'execute') return Reflect.get(target, property, receiver);
        return (query: SQL) => {
          statements.push(dialect.sqlToQuery(query).sql);
          return target.execute(query);
        };
      },
    }) as Tx;
    const request = [must(pairs()[1]), must(pairs()[0]), must(pairs()[1])];
    expect(await lockPackageRedemptionComponents(observed, scope, request)).toHaveLength(3);
    expect(statements).toHaveLength(3);
    const lock = must(statements[1]);
    expect(lock).toMatch(/ORDER BY c.id FOR UPDATE OF c/);
    expect(lock.match(/::uuid/g)).toHaveLength(4);
    expect(statements[2]).toBe(statements[0]);
  });
});

it('returns uniform null for unknown, foreign business, customer and service, with no partial batch', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    for (const request of [
      [{ entitlementId: ids.newId(), serviceId: must(f.services[0]) }],
      [{ entitlementId: otherBusinessEntitlement, serviceId: otherService }],
      [{ entitlementId: entitlement, serviceId: must(f.services[3]) }],
      [must(pairs()[0]), { entitlementId: foreignEntitlement, serviceId: must(f.services[0]) }],
    ])
      expect(await lockPackageRedemptionComponents(tx, scope, request)).toBeNull();
    expect(
      await lockPackageRedemptionComponents(tx, { ...scope, customerId: ids.newId() }, pairs()),
    ).toBeNull();
    expect(
      await lockPackageRedemptionComponents(tx, scope, [
        { entitlementId: 'bad', serviceId: 'bad' },
      ]),
    ).toBeNull();
    expect(await lockPackageRedemptionComponents(tx, scope, [])).toBeNull();
    expect(
      await lockPackageRedemptionComponents(tx, scope, Array(21).fill(must(pairs()[0]))),
    ).toBeNull();
  });
});

it('RLS hides foreign identifiers even when the supplied scope names the foreign company', async () => {
  const rows = await f.h
    .owner`SELECT customer_id FROM package_entitlements WHERE id=${foreignEntitlement}`;
  await f.db.withTenant(f.company, async (tx) => {
    const service = await f.h
      .owner`SELECT service_id FROM package_components WHERE id=${foreignComponent}`;
    expect(
      await lockPackageRedemptionComponents(
        tx,
        {
          companyId: f.otherCompany,
          businessId: f.foreignBusiness,
          customerId: must(rows[0])['customer_id'] as string,
        },
        [
          {
            entitlementId: foreignEntitlement,
            serviceId: must(service[0])['service_id'] as string,
          },
        ],
      ),
    ).toBeNull();
  });
});

it('reads exact lowest FREE ordinals and stored mills without consuming them', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const snapshot = must(must(await lockPackageRedemptionComponents(tx, scope, pairs()))[0]);
    const first = must(await readPackageRedemptionFreeSlots(tx, snapshot, 3));
    expect(first.map((row) => row.ordinal)).toEqual([2, 3, 4]);
    expect(first.map((row) => row.unitValue)).toEqual([1365n, 1000n, 1000n]);
    expect(await readPackageRedemptionFreeSlots(tx, snapshot, 3)).toEqual(first);
    for (const count of [0, -1, 21, 1.5, NaN]) {
      expect(await readPackageRedemptionFreeSlots(tx, snapshot, count)).toBeNull();
    }
    expect(await readPackageRedemptionFreeSlots(tx, { ...snapshot }, 1)).toBeNull();
  });
});

it('a competing transaction really waits on the held component lock', async () => {
  await f.db.withTenant(f.company, async (first) => {
    expect(await lockPackageRedemptionComponents(first, scope, pairs())).toHaveLength(2);
    await expect(
      f.db.withTenant(f.company, async (second) => {
        await second.execute(sql`SET LOCAL lock_timeout = '100ms'`);
        await lockPackageRedemptionComponents(second, scope, pairs());
      }),
    ).rejects.toMatchObject({ cause: { code: '55P03' } });
  });
  expect(
    await f.db.withTenant(f.company, (tx) => lockPackageRedemptionComponents(tx, scope, pairs())),
  ).toHaveLength(2);
});

type Plan = {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  Plans?: Plan[];
};

it('EXPLAIN measures the actual bounded read on 365 slots with other components present', async () => {
  await f.h.owner`ANALYZE package_session_slots`;
  await f.db.withTenant(f.company, async (tx) => {
    const snapshot = must(must(await lockPackageRedemptionComponents(tx, scope, pairs()))[0]);
    let query: SQL | undefined;
    const observed = new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== 'execute') return Reflect.get(target, property, receiver);
        return (statement: SQL) => {
          query = statement;
          return target.execute(statement);
        };
      },
    }) as Tx;
    // نفس كائن المعاملة لازم يحمل القفل؛ نأخذ لقطة منه قبل اعتراض قراءة الجلسات.
    const lockedSnapshot = must(
      must(await lockPackageRedemptionComponents(observed, scope, pairs()))[0],
    );
    expect(await readPackageRedemptionFreeSlots(observed, lockedSnapshot, 20)).toHaveLength(20);
    const result = await tx.execute<{ 'QUERY PLAN': { Plan: Plan }[] }>(
      sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${must(query)}`,
    );
    const plan = must(must(result[0])['QUERY PLAN'][0]).Plan;
    const nodes = (node: Plan): Plan[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
    const index = must(
      nodes(plan).find((node) => node['Index Name'] === 'package_session_slots_free_idx'),
    );
    expect({
      rows: plan['Actual Rows'],
      loops: plan['Actual Loops'],
      type: plan['Node Type'],
    }).toEqual({ rows: 20, loops: 1, type: 'Limit' });
    expect({
      rows: index['Actual Rows'],
      loops: index['Actual Loops'],
      filtered: index['Rows Removed by Filter'] ?? 0,
      company: index['Index Cond']?.includes('company_id') ?? false,
      component: index['Index Cond']?.includes('component_id') ?? false,
    }).toEqual({ rows: 20, loops: 1, filtered: 0, company: true, component: true });
    expect(snapshot.componentId).toBe(lockedSnapshot.componentId);
  });
});
