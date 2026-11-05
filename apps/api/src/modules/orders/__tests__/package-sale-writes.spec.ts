import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { planPackageSale, type PackageSaleIdentities } from '../domain/package-sale-plan.ts';
import type { SalePackageType } from '../domain/package-sale-types.ts';
import { insertPackageSale } from '../persistence/package-sale-writes.ts';
import { ids, must } from './session.fixture.ts';
import { packageSaleFixture, type PackageSaleFixture } from './package-sale.fixture.ts';

let f: PackageSaleFixture;

beforeAll(async () => {
  f = await packageSaleFixture();
});
afterAll(async () => {
  await f?.close();
});

const type = (): SalePackageType => ({
  id: f.packageType,
  name_en: 'Synthetic write package',
  name_ar: null,
  price: 30000n,
  validity_days: 90,
  revision: 1,
  components: [
    {
      service_id: f.firstService,
      sessions: 4,
      position: 1,
      service: {
        id: f.firstService,
        name_en: 'Synthetic write service',
        name_ar: null,
        price: 25000n,
        rule: { kind: 'ZERO' },
        counts: true,
        revision: 1,
      },
    },
  ],
});
const identities = (): PackageSaleIdentities => ({
  saleId: ids.newId(),
  components: [
    {
      serviceId: f.firstService,
      id: ids.newId(),
      slots: Array.from({ length: 4 }, (_unused, index) => ({ ordinal: index + 1, id: ids.newId() })),
    },
  ],
});
const plan = (pricePaid = 30000n) =>
  planPackageSale(
    {
      type: type(),
      pricePaid,
      limitBps: null,
      companyId: f.company,
      businessId: f.business,
      branchId: f.branch,
      customerId: f.customer,
      recorderUserId: f.userId,
      recorderMembershipId: f.membership,
      seller: {
        id: must(f.employees[0]),
        name_en: 'Synthetic employee 0',
        name_ar: null,
        user_id: null,
        eligible: true,
        clocked_in: false,
        approved_leave: false,
      },
      paidMethod: 'CASH',
      soldAt: undefined,
      recordedAt: new Date('2026-10-15T08:00:00.000Z'),
      timezone: 'Asia/Kuwait',
    },
    identities(),
  );

it('writes the entitlement, its component and its sessions with the split values', async () => {
  const sale = plan();
  await f.db.withTenant(f.company, (tx) => insertPackageSale(tx, sale));
  const entitlement = await f.h.owner`SELECT price_paid,discount,revision,sold_business_date::text AS sold_business_date FROM package_entitlements WHERE id=${sale.entitlement.id}`;
  expect(entitlement).toEqual([
    { price_paid: '30.000', discount: '0.000', revision: 1, sold_business_date: '2026-10-15' },
  ]);
  const components = await f.h.owner`SELECT sessions_total,component_value FROM package_components WHERE entitlement_id=${sale.entitlement.id}`;
  expect(components).toEqual([{ sessions_total: 4, component_value: '30.000' }]);
  const slots = await f.h.owner`SELECT ordinal,unit_value,state FROM package_session_slots WHERE entitlement_id=${sale.entitlement.id} ORDER BY ordinal`;
  expect(slots).toEqual([
    { ordinal: 1, unit_value: '7.500', state: 'FREE' },
    { ordinal: 2, unit_value: '7.500', state: 'FREE' },
    { ordinal: 3, unit_value: '7.500', state: 'FREE' },
    { ordinal: 4, unit_value: '7.500', state: 'FREE' },
  ]);
});

it('refuses a plan whose components do not sum to the price paid', async () => {
  const sale = plan();
  const tampered = {
    ...sale,
    components: sale.components.map((component) => ({
      ...component,
      component_value: component.component_value - 1n,
    })),
  };
  await expect(
    f.db.withTenant(f.company, (tx) => insertPackageSale(tx, tampered)),
  ).rejects.toMatchObject({ constraint_name: 'package_entitlement_value_conservation' });
  const rows = await f.h.owner`SELECT id FROM package_entitlements WHERE id=${sale.entitlement.id}`;
  expect(rows).toHaveLength(0);
});

it('keeps the sale rows invisible to another company', async () => {
  const sale = plan();
  await f.db.withTenant(f.company, (tx) => insertPackageSale(tx, sale));
  const visible = await f.db.withTenant(f.otherCompany, (tx) =>
    tx.execute(sql`SELECT id FROM package_entitlements WHERE id=${sale.entitlement.id}`),
  );
  expect(visible).toHaveLength(0);
});
