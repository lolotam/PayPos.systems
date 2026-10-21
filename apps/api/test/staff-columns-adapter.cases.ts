import type { Tx } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { permissionFixture, type PermissionFixture } from './permissions-fixture.ts';

interface StaffColumnsReader {
  allowed(tx: Tx, companyId: string, businessId: string): Promise<ReadonlySet<string>>;
  monthsBack(tx: Tx, companyId: string, businessId: string): Promise<number>;
}

const DEFAULT = [
  'date',
  'time',
  'service',
  'customer_name',
  'share',
  'estimated_commission',
  'tip',
];

/**
 * The cases every consumer's StaffColumnsPort adapter must pass on a real database (spec 060 MY-13, MY-17,
 * MY-18, FR-A08): the saved values travel unchanged, NULL is the default, rating_average never arrives.
 *
 * @param adapter the consumer's adapter
 */
export function staffColumnsAdapterCases(adapter: StaffColumnsReader): void {
  let f: PermissionFixture;
  beforeAll(async () => {
    f = await permissionFixture();
  });
  afterAll(async () => {
    await f?.db.close();
    await f?.h.close();
  });
  const read = () =>
    f.db.withTenant(f.company, async (tx) => ({
      columns: [...(await adapter.allowed(tx, f.company, f.business))],
      monthsBack: await adapter.monthsBack(tx, f.company, f.business),
    }));
  const store = (columns: string[] | null, months: number | null) => f.h.owner`
    INSERT INTO business_settings (company_id, business_id, staff_columns, staff_months_back)
    VALUES (${f.company}, ${f.business}, ${columns}, ${months})
    ON CONFLICT (company_id, business_id)
    DO UPDATE SET staff_columns = EXCLUDED.staff_columns, staff_months_back = EXCLUDED.staff_months_back`;

  it('MY-17 no row and NULL values: the MY-Q3 default without rating_average, and one month', async () => {
    expect(await read()).toEqual({ columns: DEFAULT, monthsBack: 1 });
    await store(null, null);
    expect(await read()).toEqual({ columns: DEFAULT, monthsBack: 1 });
  });

  it('MY-18/MY-13 the saved set and months back (3, 24) arrive; a stored rating_average does not', async () => {
    await store(['tip', 'date', 'rating_average'], 3);
    expect(await read()).toEqual({ columns: ['date', 'tip'], monthsBack: 3 });
    await store([], 24);
    expect(await read()).toEqual({ columns: [], monthsBack: 24 });
  });

  it('reads only the business asked for', async () => {
    await store(['net'], 5);
    const other = await f.db.withTenant(f.company, async (tx) => ({
      columns: [...(await adapter.allowed(tx, f.company, f.otherBusiness))],
      monthsBack: await adapter.monthsBack(tx, f.company, f.otherBusiness),
    }));
    expect(other).toEqual({ columns: DEFAULT, monthsBack: 1 });
  });
}
