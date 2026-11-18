import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../openapi.js';
import { packageSaleContext, packageSaleSellerOptionPage } from '../orders/package-sale-context.js';

const membershipId = '01920000-0000-7000-8000-000000000051';
const sellerId = '01920000-0000-7000-8000-000000000052';
const recorder = {
  membership_id: membershipId,
  scope_type: 'BRANCH' as const,
  scope_id: '01920000-0000-7000-8000-000000000053',
};
const context = {
  generated_at: '2026-10-15T08:00:00.000Z',
  business_timezone: 'Asia/Kuwait',
  customer_entry_scope: 'branch' as const,
  recorders: [recorder],
};

describe('package sale context contract', () => {
  it('keeps the fresh anchor and sale-eligible recorder facts', () => {
    expect(packageSaleContext.parse(context)).toEqual(context);
    expect(packageSaleContext.safeParse({ ...context, recorders: [] }).success).toBe(false);
    const parsed = packageSaleContext.parse({ ...context, extra: true });
    expect(parsed).toEqual(context);
    expect(parsed).not.toHaveProperty('extra');
  });

  it('projects only seller choice facts and a bounded opaque cursor', () => {
    const seller = {
      id: sellerId,
      name_ar: null,
      name_en: 'Synthetic seller',
      employee_number: 7,
    };
    expect(
      packageSaleSellerOptionPage.parse({
        sale_anchor: context.generated_at,
        items: [seller],
        next_cursor: null,
      }),
    ).toEqual({
      sale_anchor: context.generated_at,
      items: [seller],
      next_cursor: null,
    });
    const parsed = packageSaleSellerOptionPage.parse({
      sale_anchor: context.generated_at,
      items: [{ ...seller, not_clocked_in_warning: true }],
      next_cursor: null,
    });
    expect(parsed.items[0]).toEqual(seller);
    expect(parsed.items[0]).not.toHaveProperty('not_clocked_in_warning');
  });

  it('registers both sale reads and their response schemas in OpenAPI', () => {
    const document = buildOpenApiDocument();
    for (const suffix of ['context', 'seller-options']) {
      const path = `/v1/businesses/{businessId}/branches/{branchId}/package-sales/${suffix}`;
      expect(document).toMatchObject({
        paths: { [path]: { get: expect.any(Object) } },
      });
    }
    for (const name of [
      'PackageSaleRecorder',
      'PackageSaleContext',
      'PackageSaleSellerOption',
      'PackageSaleSellerOptionPage',
    ]) {
      expect(document).toMatchObject({
        components: { schemas: { [name]: expect.any(Object) } },
      });
    }
  });
});
