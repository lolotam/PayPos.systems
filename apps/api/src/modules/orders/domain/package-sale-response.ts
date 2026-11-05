import { moneyToString } from '@pospay/domain';

import type { planPackageSale } from './package-sale-plan.ts';

/** خطة البيع كما ترجعها دومين 42-3a؛ الرد بيتبني منها، فمفيش حساب تاني. */
type PackageSalePlan = ReturnType<typeof planPackageSale>;

/**
 * يبني رد بيع الباقة من الخطة المحسوبة؛ المبلغ بالفلس بيتحول لنص بالدينار contract بيفهمه.
 *
 * @param plan خطة البيع المحسوبة في الدومين
 * @returns رد البيع: الاستحقاق ومكوناته بالمبالغ النصية
 */
export function saleResponse(plan: PackageSalePlan) {
  const entitlement = plan.entitlement;
  return {
    entitlement: {
      id: entitlement.id,
      business_id: entitlement.business_id,
      customer_id: entitlement.customer_id,
      package_type_id: entitlement.package_type_id,
      sold_branch_id: entitlement.sold_branch_id,
      name_en: entitlement.name_en,
      name_ar: entitlement.name_ar,
      validity_days: entitlement.validity_days,
      list_price: moneyToString(entitlement.list_price),
      price_paid: moneyToString(entitlement.price_paid),
      discount: moneyToString(entitlement.discount),
      discount_bps: entitlement.discount_bps,
      paid_method: entitlement.paid_method,
      seller_employee_id: entitlement.seller_employee_id,
      sold_at: entitlement.sold_at,
      sold_business_date: entitlement.sold_business_date,
      late: entitlement.late,
      expires_on: entitlement.expires_on,
      refunded_amount: moneyToString(entitlement.refunded_amount),
      revision: entitlement.revision,
      components: plan.components.map((component) => ({
        id: component.id,
        service_id: component.service_id,
        position: component.position,
        name_en: component.name_en,
        name_ar: component.name_ar,
        list_price_snapshot: moneyToString(component.list_price_snapshot),
        sessions_total: component.sessions_total,
        component_value: moneyToString(component.component_value),
      })),
    },
  };
}
