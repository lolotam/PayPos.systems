import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  CustomerPackageReadError,
  CustomerPackagesQueryHandler,
  customerPackagesStatement,
  type CustomerPackageScope,
} from '../queries/customer-packages.query.ts';
import { must } from './session.fixture.ts';
import {
  customerPackagesExplainFixture,
  customerPackagesFixture,
} from './customer-packages.fixture.ts';

let fixture: Awaited<ReturnType<typeof customerPackagesFixture>>;
let handler: CustomerPackagesQueryHandler;
let scope: CustomerPackageScope;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];

// البادئات المقبولة لفهرس كل جدول؛ المخطِّط بيختار بين الفهارس اللي بتبدأ بنفس الأعمدة حسب الإحصائيات
const expectedIndexPrefixes: Record<string, string[]> = {
  package_entitlements: ['package_entitlements_customer_'],
  package_components: ['package_components_entitlement_'],
  package_session_slots: ['package_session_slots_component_', 'package_session_slots_free_idx'],
};

function expectIndexedPlan(plan: PlanNode[]): void {
  // Bitmap Index Scan بيحمل اسم الفهرس من غير اسم الجدول، فبنجمع الأسماء من كل العُقد
  const indexNames = plan.flatMap((node) => (node['Index Name'] ? [node['Index Name']] : []));
  for (const [table, prefixes] of Object.entries(expectedIndexPrefixes)) {
    const scans = plan.filter((node) => node['Relation Name'] === table);
    expect(scans.length, table).toBeGreaterThan(0);
    expect(
      scans.map((node) => node['Node Type']),
      table,
    ).not.toContain('Seq Scan');
    const matching = indexNames.filter((name) =>
      prefixes.some((prefix) => name.startsWith(prefix)),
    );
    expect(matching, `${table}: ${indexNames.join(',')}`).not.toHaveLength(0);
  }
}

beforeAll(async () => {
  fixture = await customerPackagesFixture();
  handler = new CustomerPackagesQueryHandler(
    fixture.f.db,
    { place: async () => 'Asia/Kuwait' },
    fixture.f.clock,
  );
  scope = {
    companyId: fixture.f.company,
    userId: fixture.f.userId,
    businessId: fixture.f.business,
    branchId: fixture.f.branch,
    customerId: fixture.f.customer,
  };
});

afterAll(async () => {
  await fixture?.f.close();
});

it('orders usable packages first by expires_on (b, a, e), then expired/used (c, d), and isolates other customer (f)', async () => {
  const page = await handler.execute(scope, { limit: 20 });
  expect(page.items.map((item) => item.id)).toEqual([
    fixture.packages.b,
    fixture.packages.a,
    fixture.packages.e,
    fixture.packages.c,
    fixture.packages.d,
  ]);
  expect(page.items.some((item) => item.id === fixture.packages.f)).toBe(false);

  const [b, a, e, c, d] = page.items;
  expect(b).toMatchObject({
    expired: false,
    used_up: false,
    provenance: 'SOLD',
    price_paid: '20.000',
  });
  expect(a).toMatchObject({
    expired: false,
    used_up: false,
    provenance: 'SOLD',
    price_paid: '32.500',
  });
  expect(e).toMatchObject({
    expired: false,
    used_up: false,
    provenance: 'IMPORTED',
    price_paid: '30.000',
  });
  expect(c).toMatchObject({
    expired: true,
    used_up: false,
    provenance: 'SOLD',
    price_paid: '10.000',
  });
  expect(d).toMatchObject({
    expired: false,
    used_up: true,
    provenance: 'SOLD',
    price_paid: '20.000',
  });
});

it('projects component counts, slot_values and next_unit_value accurately with IMPORTED_USED as used', async () => {
  const page = await handler.execute(scope, { limit: 20 });
  const a = must(page.items.find((item) => item.id === fixture.packages.a));
  const compA = must(a.components[0]);
  expect(compA.remaining).toBe(2);
  expect(compA.used).toBe(1);
  // TODO(spec): صف 46-1 (استرداد الباقة) — لسه مفيش مسار حقيقي يعمل جلسة REFUNDED،
  // فعدّ refunded > 0 مش متغطي هنا لحد ما الصف ده يندمج
  expect(compA.refunded).toBe(0);
  expect(compA.next_unit_value).toBe('10.000');
  expect(compA.slot_values).toEqual([
    { unit_value: '10.000', free: 1, used: 1, refunded: 0 },
    { unit_value: '12.500', free: 1, used: 0, refunded: 0 },
  ]);

  const e = must(page.items.find((item) => item.id === fixture.packages.e));
  const compE = must(e.components[0]);
  expect(compE.remaining).toBe(1);
  expect(compE.used).toBe(2);
  expect(compE.refunded).toBe(0);
  expect(compE.next_unit_value).toBe('10.000');
  expect(compE.slot_values).toEqual([{ unit_value: '10.000', free: 1, used: 2, refunded: 0 }]);

  const d = must(page.items.find((item) => item.id === fixture.packages.d));
  const compD = must(d.components[0]);
  expect(compD.remaining).toBe(0);
  expect(compD.used).toBe(2);
  expect(compD.refunded).toBe(0);
  expect(compD.next_unit_value).toBeNull();
  expect(compD.slot_values).toEqual([{ unit_value: '10.000', free: 0, used: 2, refunded: 0 }]);
});

it('walks pages with limit=2 with no duplicates and no gaps, ending with null next_cursor', async () => {
  const page1 = await handler.execute(scope, { limit: 2 });
  expect(page1.items.map((i) => i.id)).toEqual([fixture.packages.b, fixture.packages.a]);
  expect(page1.next_cursor).not.toBeNull();

  const page2 = await handler.execute(scope, { limit: 2, cursor: must(page1.next_cursor) });
  expect(page2.items.map((i) => i.id)).toEqual([fixture.packages.e, fixture.packages.c]);
  expect(page2.next_cursor).not.toBeNull();

  const page3 = await handler.execute(scope, { limit: 2, cursor: must(page2.next_cursor) });
  expect(page3.items.map((i) => i.id)).toEqual([fixture.packages.d]);
  expect(page3.next_cursor).toBeNull();
});

it('rejects a cursor from another customer or a garbage cursor with CUSTOMER_PACKAGES_CURSOR_INVALID', async () => {
  const foreignCursor = Buffer.from(
    JSON.stringify({
      customer_id: fixture.otherCustomer,
      rank: 0,
      expires_on: '2026-10-25',
      id: fixture.packages.b,
    }),
  ).toString('base64url');

  await expect(handler.execute(scope, { limit: 20, cursor: foreignCursor })).rejects.toThrow(
    new RangeError('CUSTOMER_PACKAGES_CURSOR_INVALID'),
  );

  await expect(
    handler.execute(scope, { limit: 20, cursor: 'bad_not_valid_cursor_json' }),
  ).rejects.toThrow(new RangeError('CUSTOMER_PACKAGES_CURSOR_INVALID'));
});

it('fails with FORBIDDEN when place returns null', async () => {
  const forbiddenHandler = new CustomerPackagesQueryHandler(
    fixture.f.db,
    { place: async () => null },
    fixture.f.clock,
  );
  await expect(forbiddenHandler.execute(scope, { limit: 20 })).rejects.toThrow(
    new CustomerPackageReadError('FORBIDDEN'),
  );
});

it('plans customerPackagesStatement on indexes with no Seq Scan and runs under 200ms', async () => {
  const explainFixture = await customerPackagesExplainFixture();
  try {
    const explainHandler = new CustomerPackagesQueryHandler(
      explainFixture.f.db,
      { place: async () => 'Asia/Kuwait' },
      explainFixture.f.clock,
    );
    const explainScope: CustomerPackageScope = {
      companyId: explainFixture.f.company,
      userId: explainFixture.f.userId,
      businessId: explainFixture.f.business,
      branchId: explainFixture.f.branch,
      customerId: explainFixture.f.customer,
    };

    await explainFixture.f.db.withTenant(
      explainFixture.f.company,
      async (tx) => {
        await tx.execute(sql`SET LOCAL enable_seqscan=off`);
        const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
          sql`EXPLAIN (ANALYZE, FORMAT JSON) ${customerPackagesStatement(
            explainFixture.f.company,
            explainFixture.f.business,
            explainFixture.f.customer,
            explainFixture.f.clock.now(),
            'Asia/Kuwait',
            null,
            21,
          )}`,
        );
        expectIndexedPlan(nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan));
      },
      { userId: explainFixture.f.userId },
    );

    const start = performance.now();
    await explainHandler.execute(explainScope, { limit: 20 });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  } finally {
    await explainFixture.f.close();
  }
});
