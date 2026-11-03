import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * جلسة واحدة من باقة: رقمها داخل المكوّن، حالتها، وقيمة الجلسة المخزّنة.
 * القيمة نص بالميّ زي ما اتخزّنت بالضبط، مش رقم JavaScript ولا إعادة تسعير.
 */
export interface PackageEntitlementDetailSlot {
  readonly ordinal: number;
  readonly state: string;
  readonly unitValue: string;
}

/**
 * مكوّن واحد من الباقة: لقطة الاسم والسعر وقت البيع، وأعداد الجلسات الحرة
 * والمستعملة والمستردّة، وكل جلسة بترتيبها. الأسماء والأسعار لقطة مخزّنة،
 * مش سعر الكتالوج الحيّ.
 */
export interface PackageEntitlementDetailComponent {
  readonly id: string;
  readonly serviceId: string;
  readonly position: number;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly listPriceSnapshot: string;
  readonly componentValue: string;
  readonly sessionsTotal: number;
  readonly remaining: number;
  readonly used: number;
  readonly refunded: number;
  readonly slots: readonly PackageEntitlementDetailSlot[];
}

/**
 * تفاصيل باقة عميلة: حقائق البيع المخزّنة والمكوّنات وجلساتها.
 * حقول البيع اللي الاستيراد مالوش قيمة فيها بتفضل null — الاستيراد مش بيع،
 * فما بنخترعش له وقت بيع ولا بائع ولا طريقة دفع.
 */
export interface PackageEntitlementDetail {
  readonly id: string;
  readonly customerId: string;
  readonly packageTypeId: string | null;
  readonly provenance: string;
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly validityDays: number | null;
  readonly listPrice: string | null;
  readonly pricePaid: string;
  readonly discount: string | null;
  readonly discountBps: number | null;
  readonly paidMethod: string | null;
  readonly sellerEmployeeId: string | null;
  readonly sellerLinkedUserId: string | null;
  readonly soldBranchId: string | null;
  readonly soldAt: string | null;
  readonly soldBusinessDate: string | null;
  readonly expiresOn: string;
  readonly refundedAmount: string;
  readonly revision: number;
  readonly components: readonly PackageEntitlementDetailComponent[];
}

type MutableComponent = Omit<PackageEntitlementDetailComponent, 'slots'> & {
  slots: PackageEntitlementDetailSlot[];
};

type EntitlementDetailRow = {
  entitlement_id: string;
  customer_id: string;
  package_type_id: string | null;
  provenance: string;
  name_en: string;
  name_ar: string | null;
  validity_days: number | null;
  list_price: string | null;
  price_paid: string;
  discount: string | null;
  discount_bps: number | null;
  paid_method: string | null;
  seller_employee_id: string | null;
  seller_linked_user_id: string | null;
  sold_branch_id: string | null;
  sold_at: string | null;
  sold_business_date: string | null;
  expires_on: string;
  refunded_amount: string;
  revision: number;
  component_id: string | null;
  service_id: string | null;
  position: number | null;
  component_name_en: string | null;
  component_name_ar: string | null;
  component_list_price: string | null;
  component_value: string | null;
  sessions_total: number | null;
  remaining: number;
  used: number;
  refunded: number;
  slot_ordinal: number | null;
  slot_state: string | null;
  slot_unit_value: string | null;
};

/**
 * استعلام تفاصيل الباقة: الاستحقاق ومكوّناته وجلساته في statement واحد.
 * الشاشة اللي بتستهلكه: «تفاصيل باقة عميلة» في الاستقبال (FR-071، شريحة 42-4).
 * الاستعلام واحد عشان الاستحقاق والمكوّنات والجلسات يتثبّتوا في لقطة واحدة؛
 * لقطة لكل جدول كانت هتسمح لصفقة جلسة تغيّر نص العرض.
 */
export function packageEntitlementDetailStatement(
  companyId: string,
  businessId: string,
  entitlementId: string,
): SQL {
  return sql`SELECT
    e.id AS entitlement_id, e.customer_id, e.package_type_id, e.provenance,
    e.name_en, e.name_ar, e.validity_days,
    e.list_price::text AS list_price, e.price_paid::text AS price_paid,
    e.discount::text AS discount, e.discount_bps, e.paid_method,
    e.seller_employee_id, e.seller_linked_user_id, e.sold_branch_id,
    to_char(e.sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS sold_at,
    to_char(e.sold_business_date, 'YYYY-MM-DD') AS sold_business_date,
    to_char(e.expires_on, 'YYYY-MM-DD') AS expires_on,
    e.refunded_amount::text AS refunded_amount, e.revision,
    c.id AS component_id, c.service_id, c.position,
    c.name_en AS component_name_en, c.name_ar AS component_name_ar,
    c.list_price_snapshot::text AS component_list_price,
    c.component_value::text AS component_value, c.sessions_total,
    (count(s.id) FILTER (WHERE s.state = 'FREE') OVER (PARTITION BY c.id))::int AS remaining,
    (count(s.id) FILTER (WHERE s.state IN ('USED','IMPORTED_USED')) OVER (PARTITION BY c.id))::int AS used,
    (count(s.id) FILTER (WHERE s.state = 'REFUNDED') OVER (PARTITION BY c.id))::int AS refunded,
    s.ordinal AS slot_ordinal, s.state AS slot_state, s.unit_value::text AS slot_unit_value
  FROM package_entitlements e
  LEFT JOIN package_components c
    ON c.company_id = e.company_id AND c.business_id = e.business_id AND c.entitlement_id = e.id
  LEFT JOIN package_session_slots s
    ON s.company_id = e.company_id AND s.business_id = e.business_id
    AND s.entitlement_id = e.id AND s.component_id = c.id
  WHERE e.company_id = ${companyId} AND e.company_id = app_company_id()
    AND e.business_id = ${businessId} AND e.id = ${entitlementId}
  ORDER BY c.position, s.ordinal`;
}

/** عمود NOT NULL جوّه الاستعلام؛ لو جه null فده غلط في الشكل مش حالة عمل. */
function required<T>(value: T | null): T {
  if (value === null) throw new Error('PACKAGE_ENTITLEMENT_DETAIL_SHAPE');
  return value;
}

function groupDetail(rows: readonly EntitlementDetailRow[]): PackageEntitlementDetail | null {
  const head = rows[0];
  if (head === undefined) return null;
  const components = new Map<string, MutableComponent>();
  for (const row of rows) {
    const componentId = row.component_id;
    if (componentId === null) continue;
    let component = components.get(componentId);
    if (component === undefined) {
      component = {
        id: componentId,
        serviceId: required(row.service_id),
        position: required(row.position),
        nameEn: required(row.component_name_en),
        nameAr: row.component_name_ar,
        listPriceSnapshot: required(row.component_list_price),
        componentValue: required(row.component_value),
        sessionsTotal: required(row.sessions_total),
        remaining: row.remaining,
        used: row.used,
        refunded: row.refunded,
        slots: [],
      };
      components.set(componentId, component);
    }
    if (row.slot_ordinal === null) continue;
    component.slots.push({
      ordinal: row.slot_ordinal,
      state: required(row.slot_state),
      unitValue: required(row.slot_unit_value),
    });
  }
  return {
    id: head.entitlement_id,
    customerId: head.customer_id,
    packageTypeId: head.package_type_id,
    provenance: head.provenance,
    nameEn: head.name_en,
    nameAr: head.name_ar,
    validityDays: head.validity_days,
    listPrice: head.list_price,
    pricePaid: head.price_paid,
    discount: head.discount,
    discountBps: head.discount_bps,
    paidMethod: head.paid_method,
    sellerEmployeeId: head.seller_employee_id,
    sellerLinkedUserId: head.seller_linked_user_id,
    soldBranchId: head.sold_branch_id,
    soldAt: head.sold_at,
    soldBusinessDate: head.sold_business_date,
    expiresOn: head.expires_on,
    refundedAmount: head.refunded_amount,
    revision: head.revision,
    components: [...components.values()],
  };
}

/**
 * يقرأ تفاصيل باقة عميلة واحدة: حقائق البيع المخزّنة ومكوّناتها وجلساتها.
 * القارئ ما بيفتحش معاملة ولا connection ولا بيكتب ولا بيقفل: المستدعي بيبعت
 * معاملة مستأجره جاهزة ونشاط متأكّد منه، والـ RLS هو خط الدفاع الأخير.
 *
 * @param tx معاملة المستأجر التي فتحها المستدعي
 * @param companyId شركة الباقة
 * @param businessId نشاط الباقة
 * @param entitlementId معرّف الاستحقاق
 * @returns تفاصيل الباقة، أو null لو المعرّف مش موجود أو تبع نشاط تاني أو شركة تانية
 */
export async function readPackageEntitlementDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  entitlementId: string,
): Promise<PackageEntitlementDetail | null> {
  const rows = await tx.execute<EntitlementDetailRow>(
    packageEntitlementDetailStatement(companyId, businessId, entitlementId),
  );
  return groupDetail(rows);
}
