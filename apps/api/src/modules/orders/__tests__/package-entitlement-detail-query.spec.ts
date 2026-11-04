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
  expect(detail.customerId).toBe(fixture.f.customer);
  expect(detail.packageTypeId).toBe(fixture.packageType);
  expect(detail.provenance).toBe('SOLD');
  expect(detail.nameEn).toBe('Sold package snapshot');
  expect(detail.nameAr).toBe('باقة مباعة');
  expect(detail.validityDays).toBe(90);
  expect(detail.listPrice).toBe('50.000');
  expect(detail.pricePaid).toBe('50.000');
  expect(detail.discount).toBe('0.000');
  expect(detail.discountBps).toBe(0);
  expect(detail.paidMethod).toBe('CASH');
  expect(detail.sellerEmployeeId).toBe(fixture.employee);
  expect(detail.sellerLinkedUserId).toBe(fixture.f.userId);
  expect(detail.soldBranchId).toBe(fixture.f.branch);
  expect(detail.soldAt).toBe('2026-10-20T09:30:00.123Z');
  expect(detail.soldBusinessDate).toBe('2026-10-20');
  expect(detail.expiresOn).toBe('2027-01-18');
  expect(detail.refundedAmount).toBe('0.000');
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
  expect(first.serviceId).toBe(must(fixture.f.services[0]));
  expect(first.nameEn).toBe('Snapshot service one');
  expect(first.listPriceSnapshot).toBe('15.000');
  expect(first.componentValue).toBe('30.000');
  expect(first.sessionsTotal).toBe(3);
  expect(first.remaining).toBe(3);
  expect(first.used).toBe(0);
  expect(first.refunded).toBe(0);
  expect(first.slots.map((slot) => slot.ordinal)).toEqual([1, 2, 3]);
  expect(first.slots.map((slot) => slot.state)).toEqual(['FREE', 'FREE', 'FREE']);
  expect(first.slots.map((slot) => slot.unitValue)).toEqual(['10.000', '10.000', '10.000']);
  const second = must(detail.components[1]);
  expect(second.componentValue).toBe('20.000');
  expect(second.slots.map((slot) => slot.unitValue)).toEqual(['6.666', '6.666', '6.668']);
});

it('leaves the sale-only fields of an imported package empty and counts its used sessions', async () => {
  const detail = must(await read(fixture.importedEntitlement));
  expect(detail.provenance).toBe('IMPORTED');
  expect(detail.pricePaid).toBe('40.000');
  expect(detail.packageTypeId).toBeNull();
  expect(detail.validityDays).toBeNull();
  expect(detail.listPrice).toBeNull();
  expect(detail.discount).toBeNull();
  expect(detail.discountBps).toBeNull();
  expect(detail.paidMethod).toBeNull();
  expect(detail.sellerEmployeeId).toBeNull();
  expect(detail.sellerLinkedUserId).toBeNull();
  expect(detail.soldBranchId).toBeNull();
  expect(detail.soldAt).toBeNull();
  expect(detail.soldBusinessDate).toBeNull();
  const component = must(detail.components[0]);
  expect(component.sessionsTotal).toBe(4);
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
      'customerId',
      'packageTypeId',
      'provenance',
      'nameEn',
      'nameAr',
      'validityDays',
      'listPrice',
      'pricePaid',
      'discount',
      'discountBps',
      'paidMethod',
      'sellerEmployeeId',
      'sellerLinkedUserId',
      'soldBranchId',
      'soldAt',
      'soldBusinessDate',
      'expiresOn',
      'refundedAmount',
      'revision',
      'components',
    ].sort(),
  );
  const component = must(detail.components[0]);
  expect(Object.keys(component).sort()).toEqual(
    [
      'id',
      'serviceId',
      'position',
      'nameEn',
      'nameAr',
      'listPriceSnapshot',
      'componentValue',
      'sessionsTotal',
      'remaining',
      'used',
      'refunded',
      'slots',
    ].sort(),
  );
  expect(Object.keys(must(component.slots[0])).sort()).toEqual(['ordinal', 'state', 'unitValue']);
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
  expect(component.nameEn).toBe('Snapshot service one');
  expect(component.listPriceSnapshot).toBe('15.000');
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
