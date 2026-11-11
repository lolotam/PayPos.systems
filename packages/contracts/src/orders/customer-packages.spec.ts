import { expect, it } from 'vitest';
import {
  customerPackageDetail,
  customerPackagePage,
  customerPackagesCursorData,
  customerPackagesQuery,
} from './customer-packages.js';

const id = '01920000-0000-7000-8000-000000004001';

const validItem = {
  id,
  provenance: 'SOLD' as const,
  name_en: 'Synthetic package',
  name_ar: null,
  expires_on: '2026-12-31',
  expired: false,
  used_up: false,
  price_paid: '20.000',
  refunded_amount: '0.000',
  components: [
    {
      id,
      service_id: id,
      position: 1,
      name_en: 'Synthetic service',
      name_ar: null,
      sessions_total: 1,
      remaining: 1,
      used: 0,
      refunded: 0,
      next_unit_value: '20.000',
      slot_values: [{ unit_value: '20.000', free: 1, used: 0, refunded: 0 }],
    },
  ],
};

const validPage = {
  items: [validItem],
  next_cursor: null,
};

const validSlot = {
  ordinal: 1,
  state: 'FREE' as const,
  unit_value: '20.000',
};

const validDetailComponent = {
  id,
  service_id: id,
  position: 1,
  name_en: 'Synthetic service',
  name_ar: null,
  list_price_snapshot: '25.000',
  component_value: '20.000',
  sessions_total: 1,
  remaining: 1,
  used: 0,
  refunded: 0,
  slots: [validSlot],
};

const validDetail = {
  id,
  customer_id: id,
  package_type_id: id,
  provenance: 'SOLD' as const,
  name_en: 'Synthetic package',
  name_ar: null,
  validity_days: 90,
  list_price: '25.000',
  price_paid: '20.000',
  discount: '5.000',
  discount_bps: 2000,
  paid_method: 'CASH' as const,
  seller_employee_id: id,
  seller_linked_user_id: id,
  sold_branch_id: id,
  sold_at: '2026-10-15T08:00:00.000Z',
  sold_business_date: '2026-10-15',
  expires_on: '2026-12-31',
  refunded_amount: '0.000',
  revision: 1,
  components: [validDetailComponent],
};

it('defaults query limit to 20 when omitted', () => {
  expect(customerPackagesQuery.parse({})).toEqual({ limit: 20 });
  expect(customerPackagesQuery.parse({ cursor: 'validCursor_123' })).toEqual({
    limit: 20,
    cursor: 'validCursor_123',
  });
});

it('rejects limit 0, limit 51, unknown keys and characters outside base64url', () => {
  expect(customerPackagesQuery.safeParse({ limit: 0 }).success).toBe(false);
  expect(customerPackagesQuery.safeParse({ limit: 51 }).success).toBe(false);
  expect(customerPackagesQuery.safeParse({ limit: 20, unknown: 'extra' }).success).toBe(false);
  for (const cursor of ['bad+char', 'bad/slash', 'bad=pad', 'bad space', '']) {
    expect(customerPackagesQuery.safeParse({ cursor }).success).toBe(false);
  }
});

it.each([
  ['a JS number', 20.0],
  ['2 decimals', '20.00'],
])('rejects money as %s on page and detail schemas', (_label, price_paid) => {
  const item = { ...validItem, price_paid };
  expect(customerPackagePage.safeParse({ ...validPage, items: [item] }).success).toBe(false);
  expect(customerPackageDetail.safeParse({ ...validDetail, price_paid }).success).toBe(false);
});

it('rejects an unknown slot state on the detail schema', () => {
  const slotWithUnknownState = { ...validSlot, state: 'EXPIRED' as unknown as 'FREE' };
  const componentWithUnknownSlot = { ...validDetailComponent, slots: [slotWithUnknownState] };
  expect(
    customerPackageDetail.safeParse({ ...validDetail, components: [componentWithUnknownSlot] })
      .success,
  ).toBe(false);
});

it('strips an extra key from page and detail responses and rejects one in the cursor', () => {
  // المتصفح يسقط المفاتيح غير المعروفة تلقائياً في عقود الرد
  const pageParsed = customerPackagePage.safeParse({ ...validPage, note: 'extra' });
  expect(pageParsed.success).toBe(true);
  if (pageParsed.success) {
    expect(pageParsed.data).not.toHaveProperty('note');
  }

  const detailParsed = customerPackageDetail.safeParse({ ...validDetail, note: 'extra' });
  expect(detailParsed.success).toBe(true);
  if (detailParsed.success) {
    expect(detailParsed.data).not.toHaveProperty('note');
  }

  const validCursor = {
    company_id: id,
    business_id: id,
    customer_id: id,
    rank: 0 as const,
    expires_on: '2026-12-31',
    id,
  };

  expect(customerPackagesCursorData.safeParse({ ...validCursor, note: 'extra' }).success).toBe(false);

  // المؤشر يتطلب الشركة والنشاط لربطه بسياق الطلب ومنع التمرير بين المستأجرين
  const withoutCompany = {
    business_id: id,
    customer_id: id,
    rank: 0 as const,
    expires_on: '2026-12-31',
    id,
  };
  expect(customerPackagesCursorData.safeParse(withoutCompany).success).toBe(false);

  const withoutBusiness = {
    company_id: id,
    customer_id: id,
    rank: 0 as const,
    expires_on: '2026-12-31',
    id,
  };
  expect(customerPackagesCursorData.safeParse(withoutBusiness).success).toBe(false);

  // رفض سنة الصفر 0000 وقبول سنة 0001
  expect(customerPackagesCursorData.safeParse({ ...validCursor, expires_on: '0000-01-01' }).success).toBe(false);
  expect(customerPackagesCursorData.safeParse({ ...validCursor, expires_on: '0001-01-01' }).success).toBe(true);
});
