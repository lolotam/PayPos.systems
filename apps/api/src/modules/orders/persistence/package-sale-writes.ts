import type { Tx } from '@pospay/db';
import { moneyToString } from '@pospay/domain';
import { sql } from 'drizzle-orm';

import type { PackageSalePlan } from '../ports/package-sale-transactions.port.ts';

/**
 * يكتب الاستحقاق ومكوناته وجلساته بالترتيب اللي يفرضه قيد الحفظ المؤجل: الاستحقاق، بعدين المكوّنات، بعدين الجلسات.
 *
 * @param tx معاملة بيع الباقة
 * @param plan خطة البيع المحسوبة بكل قيمها
 * @returns يكتمل حفظ الاستحقاق ومكوناته وجلساته قبل أي أثر تاني
 */
export async function insertPackageSale(tx: Tx, plan: PackageSalePlan): Promise<void> {
  const entitlement = plan.entitlement;
  await tx.execute(sql`INSERT INTO package_entitlements(company_id,id,business_id,customer_id,package_type_id,provenance,name_en,name_ar,
    validity_days,list_price,price_paid,discount,discount_bps,paid_method,seller_employee_id,seller_linked_user_id,sold_branch_id,sold_at,
    sold_business_date,sold_timezone,late,recorded_by,recorded_by_membership_id,expires_on,refunded_amount,revision)
    VALUES(${entitlement.company_id},${entitlement.id},${entitlement.business_id},${entitlement.customer_id},${entitlement.package_type_id},
      ${entitlement.provenance},${entitlement.name_en},${entitlement.name_ar},${entitlement.validity_days},${moneyToString(entitlement.list_price)},
      ${moneyToString(entitlement.price_paid)},${moneyToString(entitlement.discount)},${entitlement.discount_bps},${entitlement.paid_method},
      ${entitlement.seller_employee_id},${entitlement.seller_linked_user_id},${entitlement.sold_branch_id},${entitlement.sold_at},
      ${entitlement.sold_business_date},${entitlement.sold_timezone},${entitlement.late},${entitlement.recorded_by},${entitlement.recorded_by_membership_id},
      ${entitlement.expires_on},${moneyToString(entitlement.refunded_amount)},${entitlement.revision})`);
  const components = plan.components.map(
    (component) => sql`(${entitlement.company_id},${component.id},${entitlement.business_id},${entitlement.id},${component.service_id},
      ${component.position},${component.name_en},${component.name_ar},${moneyToString(component.list_price_snapshot)},
      ${component.sessions_total},${moneyToString(component.component_value)})`,
  );
  await tx.execute(sql`INSERT INTO package_components(company_id,id,business_id,entitlement_id,service_id,position,name_en,name_ar,
    list_price_snapshot,sessions_total,component_value) VALUES ${sql.join(components, sql`,`)}`);
  const slots = plan.components.flatMap((component) =>
    component.slots.map((slot) => ({
      id: slot.id,
      business_id: entitlement.business_id,
      entitlement_id: entitlement.id,
      component_id: component.id,
      ordinal: slot.ordinal,
      unit_value: moneyToString(slot.unitValue),
    })),
  );
  // الجلسات بتمر كـ array لكل عمود: ٧٣٠٠ صف × ٦ أعمدة يطلع فوق حد الـ parameters في PostgreSQL.
  // القيم النصية بتتحول لـ numeric في جوه الـ SELECT عشان postgres.js يسلّمها نص[] مش numeric[].
  await tx.execute(sql`INSERT INTO package_session_slots(company_id,id,business_id,entitlement_id,component_id,ordinal,unit_value,state)
    SELECT ${entitlement.company_id},s.id,s.business_id,s.entitlement_id,s.component_id,s.ordinal,s.unit_value::numeric,'FREE'
    FROM unnest(${sql.param(slots.map((slot) => slot.id))}::uuid[],${sql.param(slots.map((slot) => slot.business_id))}::uuid[],
      ${sql.param(slots.map((slot) => slot.entitlement_id))}::uuid[],${sql.param(slots.map((slot) => slot.component_id))}::uuid[],
      ${sql.param(slots.map((slot) => slot.ordinal))}::int[],${sql.param(slots.map((slot) => slot.unit_value))}::text[])
      AS s(id,business_id,entitlement_id,component_id,ordinal,unit_value)`);
}
