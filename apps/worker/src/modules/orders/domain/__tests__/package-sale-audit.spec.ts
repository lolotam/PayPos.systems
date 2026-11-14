import { expect, it } from 'vitest';
import { saleAudit } from '../package-sale-audit.ts';
import { planPackageSale } from '../package-sale-plan.ts';
import { identities, input } from './fixtures/package-sale.ts';

const plan = planPackageSale(input, identities);

it('records exactly the safe sale facts, without the customer name or phone', () => {
  const audit = saleAudit(plan);
  expect(Object.keys(audit)).toEqual(['entity', 'entityId', 'action', 'after']);
  expect(Object.keys(audit.after)).toEqual([
    'sale_id',
    'business_id',
    'branch_id',
    'customer_id',
    'package_type_id',
    'list_price',
    'price_paid',
    'discount',
    'discount_bps',
    'paid_method',
    'seller_employee_id',
    'seller_linked_user_id',
    'recorded_by',
    'recorded_by_membership_id',
    'sold_at',
    'sold_business_date',
    'sold_timezone',
    'expires_on',
    'late',
    'revision',
    'component_count',
    'session_count',
  ]);
  expect(audit.after).toEqual({
    sale_id: 'sale',
    business_id: 'business',
    branch_id: 'branch',
    customer_id: 'customer',
    package_type_id: 'type',
    list_price: '25.000',
    price_paid: '22.500',
    discount: '2.500',
    discount_bps: 1000,
    paid_method: 'CASH',
    seller_employee_id: 'seller',
    seller_linked_user_id: 'seller-user',
    recorded_by: 'recorder',
    recorded_by_membership_id: 'membership',
    sold_at: '2026-10-01T08:00:00.000Z',
    sold_business_date: '2026-10-01',
    sold_timezone: 'Asia/Kuwait',
    expires_on: '2026-12-30',
    late: false,
    revision: 1,
    component_count: 1,
    session_count: 10,
  });
  // العميلة بتوصل بالهوية بس؛ الاسم والرقم مش حقّ أثر التدقيق أصلاً.
  expect(Object.keys(audit.after).filter((key) => /name|phone/i.test(key))).toEqual([]);
});

it('counts every component and every session of the sold package', () => {
  const first = input.type.components[0];
  if (first === undefined) throw new Error('fixture requires a component');
  const components = [
    first,
    {
      ...first,
      service_id: 'service-2',
      position: 2,
      sessions: 2,
      service: { ...first.service, id: 'service-2', price: 2000n },
    },
  ];
  const mixed = planPackageSale(
    { ...input, type: { ...input.type, components } },
    {
      saleId: 'sale',
      components: components.map((component) => ({
        serviceId: component.service_id,
        id: `component-${component.service_id}`,
        slots: Array.from({ length: component.sessions }, (_, index) => ({
          ordinal: index + 1,
          id: `slot-${component.service_id}-${index + 1}`,
        })),
      })),
    },
  );
  const audit = saleAudit(mixed);
  expect(audit.after.component_count).toBe(2);
  expect(audit.after.session_count).toBe(12);
});
