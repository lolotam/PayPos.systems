import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  packageEntitlementDetailStatement,
  readPackageEntitlementDetail,
} from '../queries/package-entitlement-detail.query.ts';
import { ids, must } from './session.fixture.ts';
import { packageEntitlementDetailFixture } from './package-entitlement-detail.fixture.ts';

let fixture: Awaited<ReturnType<typeof packageEntitlementDetailFixture>>;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  Plans?: PlanNode[];
}
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const actualRows = (plan: PlanNode[], relation: string): number =>
  plan
    .filter((node) => node['Relation Name'] === relation)
    .reduce((sum, node) => sum + (node['Actual Rows'] ?? 0) * (node['Actual Loops'] ?? 1), 0);
// الفهارس الموجودة فعلاً في هجرة 0200 لكل جدول: الفهرس اللي بيخدم القراءة لازم يكون منها.
const SUPPORTING_INDEXES: Record<string, readonly string[]> = {
  package_entitlements: ['package_entitlements_pkey', 'package_entitlements_business_id_key'],
  package_components: [
    'package_components_entitlement_fk_idx',
    'package_components_entitlement_id_key',
    'package_components_entitlement_position_key',
    'package_components_entitlement_service_key',
  ],
  package_session_slots: [
    'package_session_slots_component_fk_idx',
    'package_session_slots_component_ordinal_key',
  ],
};

const read = (entitlementId: string, businessId?: string, companyId?: string) => {
  const tenant = companyId ?? fixture.f.company;
  const business = businessId ?? fixture.f.business;
  return fixture.f.db.withTenant(tenant, (tx) =>
    readPackageEntitlementDetail(tx, tenant, business, entitlementId),
  );
};

beforeAll(async () => {
  fixture = await packageEntitlementDetailFixture();
});

afterAll(async () => {
  await fixture?.f.close();
});

it('reads the stored sale facts of a sold package', async () => {
  const detail = must(await read(fixture.soldEntitlement));
  expect(detail.id).toBe(fixture.soldEntitlement);
  expect(detail.customer_id).toBe(fixture.f.customer);
  expect(detail.package_type_id).toBe(fixture.packageType);
  expect(detail.provenance).toBe('SOLD');
  expect(detail.name_en).toBe('Sold package snapshot');
  expect(detail.name_ar).toBe('باقة مباعة');
  expect(detail.validity_days).toBe(90);
  expect(detail.list_price).toBe('50.000');
  expect(detail.price_paid).toBe('50.000');
  expect(detail.discount).toBe('0.000');
  expect(detail.discount_bps).toBe(0);
  expect(detail.paid_method).toBe('CASH');
  expect(detail.seller_employee_id).toBe(fixture.employee);
  expect(detail.seller_linked_user_id).toBe(fixture.f.userId);
  expect(detail.sold_branch_id).toBe(fixture.f.branch);
  expect(detail.sold_at).toBe('2026-10-20T09:30:00.123Z');
  expect(detail.sold_business_date).toBe('2026-10-20');
  expect(detail.expires_on).toBe('2027-01-18');
  expect(detail.refunded_amount).toBe('0.000');
  expect(detail.revision).toBe(1);
});

it('reads the components in position order with their exact stored values', async () => {
  const detail = must(await read(fixture.soldEntitlement));
  expect(detail.components).toHaveLength(2);
  expect(detail.components.map((component) => component.position)).toEqual([1, 2]);
  expect(detail.components.map((component) => component.id)).toEqual([
    fixture.soldComponentOne,
    fixture.soldComponentTwo,
  ]);
  const first = must(detail.components[0]);
  expect(first.service_id).toBe(must(fixture.f.services[0]));
  expect(first.name_en).toBe('Snapshot service one');
  expect(first.list_price_snapshot).toBe('15.000');
  expect(first.component_value).toBe('30.000');
  expect(first.sessions_total).toBe(3);
  expect(first.remaining).toBe(3);
  expect(first.used).toBe(0);
  expect(first.refunded).toBe(0);
  expect(first.slots.map((slot) => slot.ordinal)).toEqual([1, 2, 3]);
  expect(first.slots.map((slot) => slot.state)).toEqual(['FREE', 'FREE', 'FREE']);
  expect(first.slots.map((slot) => slot.unit_value)).toEqual(['10.000', '10.000', '10.000']);
  const second = must(detail.components[1]);
  expect(second.component_value).toBe('20.000');
  expect(second.slots.map((slot) => slot.unit_value)).toEqual(['6.666', '6.666', '6.668']);
});

it('leaves the sale-only fields of an imported package empty and counts its used sessions', async () => {
  const detail = must(await read(fixture.importedEntitlement));
  expect(detail.provenance).toBe('IMPORTED');
  expect(detail.price_paid).toBe('40.000');
  expect(detail.package_type_id).toBeNull();
  expect(detail.validity_days).toBeNull();
  expect(detail.list_price).toBeNull();
  expect(detail.discount).toBeNull();
  expect(detail.discount_bps).toBeNull();
  expect(detail.paid_method).toBeNull();
  expect(detail.seller_employee_id).toBeNull();
  expect(detail.seller_linked_user_id).toBeNull();
  expect(detail.sold_branch_id).toBeNull();
  expect(detail.sold_at).toBeNull();
  expect(detail.sold_business_date).toBeNull();
  const component = must(detail.components[0]);
  expect(component.sessions_total).toBe(4);
  expect(component.remaining).toBe(2);
  expect(component.used).toBe(2);
  expect(component.refunded).toBe(0);
  expect(component.slots.map((slot) => slot.state)).toEqual([
    'IMPORTED_USED',
    'IMPORTED_USED',
    'FREE',
    'FREE',
  ]);
});

it('answers the same empty way for an unknown, another-business and another-tenant package', async () => {
  expect(await read(ids.newId())).toBeNull();
  expect(await read(fixture.soldEntitlement, fixture.f.secondBusiness)).toBeNull();
  expect(
    await read(fixture.soldEntitlement, fixture.f.foreignBusiness, fixture.f.otherCompany),
  ).toBeNull();
});

it('keeps the tenant isolation in the database and not in the reader', async () => {
  const own = await fixture.f.db.withTenant(fixture.f.company, (tx) =>
    tx.execute<{ id: string }>(sql`SELECT id FROM package_entitlements`),
  );
  const foreign = await fixture.f.db.withTenant(fixture.f.otherCompany, (tx) =>
    tx.execute<{ id: string }>(sql`SELECT id FROM package_entitlements`),
  );
  expect(own.length).toBeGreaterThan(0);
  expect(foreign).toHaveLength(0);
  const mismatched = await fixture.f.db.withTenant(fixture.f.company, (tx) =>
    readPackageEntitlementDetail(
      tx,
      fixture.f.otherCompany,
      fixture.f.business,
      fixture.soldEntitlement,
    ),
  );
  expect(mismatched).toBeNull();
});

it('shows no phone and no field the detail does not own', async () => {
  const detail = must(await read(fixture.soldEntitlement));
  expect(Object.keys(detail).sort()).toEqual(
    [
      'id',
      'customer_id',
      'package_type_id',
      'provenance',
      'name_en',
      'name_ar',
      'validity_days',
      'list_price',
      'price_paid',
      'discount',
      'discount_bps',
      'paid_method',
      'seller_employee_id',
      'seller_linked_user_id',
      'sold_branch_id',
      'sold_at',
      'sold_business_date',
      'expires_on',
      'refunded_amount',
      'revision',
      'components',
    ].sort(),
  );
  const component = must(detail.components[0]);
  expect(Object.keys(component).sort()).toEqual(
    [
      'id',
      'service_id',
      'position',
      'name_en',
      'name_ar',
      'list_price_snapshot',
      'component_value',
      'sessions_total',
      'remaining',
      'used',
      'refunded',
      'slots',
    ].sort(),
  );
  expect(Object.keys(must(component.slots[0])).sort()).toEqual(['ordinal', 'state', 'unit_value']);
  expect(JSON.stringify(detail)).not.toContain('+999999998123');
  expect(JSON.stringify(detail)).not.toContain('created_system_id');
  expect(JSON.stringify(detail)).not.toContain('created_txid');
});

it('keeps the stored component snapshots when the catalog changes', async () => {
  await fixture.f.db.withTenant(fixture.f.company, (tx) =>
    tx.execute(
      sql`UPDATE services SET name_en='Renamed after the sale', price=99.000
        WHERE company_id=${fixture.f.company} AND id=${must(fixture.f.services[0])}`,
    ),
  );
  const detail = must(await read(fixture.soldEntitlement));
  const component = must(detail.components[0]);
  expect(component.name_en).toBe('Snapshot service one');
  expect(component.list_price_snapshot).toBe('15.000');
  expect(JSON.stringify(detail)).not.toContain('Renamed after the sale');
  expect(JSON.stringify(detail)).not.toContain('99.000');
});

it('plans the detail read on the package indexes', async () => {
  await fixture.f.db.withTenant(
    fixture.f.company,
    async (tx) => {
      const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
        sql`EXPLAIN (ANALYZE, FORMAT JSON) ${packageEntitlementDetailStatement(fixture.f.company, fixture.f.business, fixture.soldEntitlement)}`,
      );
      const plan = nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
      for (const table of ['package_entitlements', 'package_components', 'package_session_slots']) {
        const scans = plan.filter((node) => node['Relation Name'] === table);
        expect(scans.length).toBeGreaterThan(0);
        expect(scans.every((node) => node['Node Type'] !== 'Seq Scan')).toBe(true);
        expect(
          plan.some((node) => (SUPPORTING_INDEXES[table] ?? []).includes(node['Index Name'] ?? '')),
        ).toBe(true);
      }
      expect(actualRows(plan, 'package_entitlements')).toBe(1);
      expect(actualRows(plan, 'package_components')).toBe(2);
      expect(actualRows(plan, 'package_session_slots')).toBe(6);
    },
    { userId: fixture.f.userId },
  );
});
