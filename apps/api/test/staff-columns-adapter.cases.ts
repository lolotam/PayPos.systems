import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
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
  'rating_average',
];

/**
 * يشيل قيد المدى المضيّق (issue #519) وبيعمل الشغل جوه، وبعدين بيرجّع القيد متحقَّق: القيمة القديمة
 * (فوق 12) ماتتستخزّنش تحت القيد الجديد، والصفوف اللي فاضلة فوق 12 بتتقصّر الأول.
 *
 * @param f    تجهيزة الاختبار اللي بتمتلك قاعدة البيانات
 * @param work الشغل اللي محتاج المدى القديم مؤقتاً
 */
async function withLegacyConstraint<T>(f: PermissionFixture, work: () => Promise<T>): Promise<T> {
  await f.h.owner`ALTER TABLE business_settings
    DROP CONSTRAINT IF EXISTS business_settings_staff_months_back`;
  try {
    return await work();
  } finally {
    await f.h.owner`UPDATE business_settings SET staff_months_back = 12
      WHERE company_id = ${f.company} AND business_id = ${f.business} AND staff_months_back > 12`;
    await f.h.owner`ALTER TABLE business_settings
      ADD CONSTRAINT business_settings_staff_months_back
      CHECK (staff_months_back IS NULL OR staff_months_back BETWEEN 1 AND 12) NOT VALID`;
    await f.h.owner`ALTER TABLE business_settings
      VALIDATE CONSTRAINT business_settings_staff_months_back`;
  }
}

/**
 * The cases every consumer's StaffColumnsPort adapter must pass on a real database (spec 060 MY-13, MY-17,
 * MY-18, FR-A08): the saved values travel unchanged and NULL is the default, rating_average included.
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
  // قيمة اتحفظت تحت المدى القديم (1..24): القيد المضيّق (issue #519) بيمنعها، فنبدّله مؤقتاً عشان
  // نحاكي بيانات قبل التضييق، والقراية بتقصّرها على 12 في الدومين، وبعدين القيد بيرجع متحقَّق.
  const storeLegacyMonthsBack = async (columns: string[], months: number) =>
    withLegacyConstraint(f, async () => {
      await store(columns, months);
      expect(await read()).toEqual({ columns, monthsBack: 12 });
    });

  it('MY-17 no row and NULL values: the MY-Q3 default with rating_average, and two months', async () => {
    expect(await read()).toEqual({ columns: DEFAULT, monthsBack: 2 });
    await store(null, null);
    expect(await read()).toEqual({ columns: DEFAULT, monthsBack: 2 });
  });

  it('MY-18/MY-13 the saved set and months back (3, 12, and a stored 24 read as 12) arrive, rating_average among them', async () => {
    await store(['tip', 'date', 'rating_average'], 3);
    expect(await read()).toEqual({ columns: ['date', 'tip', 'rating_average'], monthsBack: 3 });
    await store(['tip', 'date'], 3);
    expect(await read()).toEqual({ columns: ['date', 'tip'], monthsBack: 3 });
    await store([], 12);
    expect(await read()).toEqual({ columns: [], monthsBack: 12 });
    await storeLegacyMonthsBack([], 24);
  });

  it('reads allowed and monthsBack from one snapshot inside a transaction', async () => {
    await store(['date'], 2);
    const seen = await f.db.withTenant(f.company, async (tx) => {
      const columns = [...(await adapter.allowed(tx, f.company, f.business))];
      await tx.execute(sql`UPDATE business_settings SET staff_columns = '{net}', staff_months_back = 9
        WHERE company_id = ${f.company} AND business_id = ${f.business}`);
      return { columns, monthsBack: await adapter.monthsBack(tx, f.company, f.business) };
    });
    expect(seen).toEqual({ columns: ['date'], monthsBack: 2 });
  });

  it('reads only the business asked for', async () => {
    await store(['net'], 5);
    const other = await f.db.withTenant(f.company, async (tx) => ({
      columns: [...(await adapter.allowed(tx, f.company, f.otherBusiness))],
      monthsBack: await adapter.monthsBack(tx, f.company, f.otherBusiness),
    }));
    expect(other).toEqual({ columns: DEFAULT, monthsBack: 2 });
  });
}
