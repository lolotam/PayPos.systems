import { moneyToString } from '@pospay/domain';

import type { planPackageSale } from './package-sale-plan.ts';

/** خطة البيع كما ترجعها دومين 42-3a؛ التدقيق بيقرا منها الحقائق المالية الآمنة. */
type PackageSalePlan = ReturnType<typeof planPackageSale>;

/**
 * يبني أثر التدقيق لبيع الباقة: مين باع، لمين، وبكام، ومن غير بيانات عميلة خاصة.
 *
 * @param plan خطة البيع المحسوبة بكل قيمها النهائية
 * @returns وصف التدقيق الآمن لل sale
 */
export function saleAudit(plan: PackageSalePlan) {
  const entitlement = plan.entitlement;
  return {
    entity: 'package_entitlement',
    entityId: entitlement.id,
    action: 'package.sold',
    after: {
      sale_id: entitlement.id,
      business_id: entitlement.business_id,
      branch_id: entitlement.sold_branch_id,
      customer_id: entitlement.customer_id,
      package_type_id: entitlement.package_type_id,
      list_price: moneyToString(entitlement.list_price),
      price_paid: moneyToString(entitlement.price_paid),
      discount: moneyToString(entitlement.discount),
      discount_bps: entitlement.discount_bps,
      paid_method: entitlement.paid_method,
      seller_employee_id: entitlement.seller_employee_id,
      seller_linked_user_id: entitlement.seller_linked_user_id,
      recorded_by: entitlement.recorded_by,
      recorded_by_membership_id: entitlement.recorded_by_membership_id,
      sold_at: entitlement.sold_at,
      sold_business_date: entitlement.sold_business_date,
      sold_timezone: entitlement.sold_timezone,
      expires_on: entitlement.expires_on,
      late: entitlement.late,
      revision: entitlement.revision,
      component_count: plan.components.length,
      session_count: plan.components.reduce((total, component) => total + component.sessions_total, 0),
    },
  };
}
