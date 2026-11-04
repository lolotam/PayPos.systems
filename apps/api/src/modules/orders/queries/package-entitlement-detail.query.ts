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

function componentProjection(): SQL {
  return sql`COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'serviceId', c.service_id,
      'position', c.position,
      'nameEn', c.name_en,
      'nameAr', c.name_ar,
      'listPriceSnapshot', c.list_price_snapshot::text,
      'componentValue', c.component_value::text,
      'sessionsTotal', c.sessions_total,
      'remaining', slots.remaining,
      'used', slots.used,
      'refunded', slots.refunded,
      'slots', slots.items
    ) ORDER BY c.position)
    FROM package_components c
    CROSS JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE s.state='FREE'))::int AS remaining,
        (count(*) FILTER (WHERE s.state IN ('USED','IMPORTED_USED')))::int AS used,
        (count(*) FILTER (WHERE s.state='REFUNDED'))::int AS refunded,
        COALESCE(jsonb_agg(jsonb_build_object(
          'ordinal', s.ordinal,
          'state', s.state,
          'unitValue', s.unit_value::text
        ) ORDER BY s.ordinal), '[]'::jsonb) AS items
      FROM package_session_slots s
      WHERE s.company_id=e.company_id AND s.business_id=e.business_id
        AND s.entitlement_id=e.id AND s.component_id=c.id
    ) slots
    WHERE c.company_id=e.company_id AND c.business_id=e.business_id
      AND c.entitlement_id=e.id
  ), '[]'::jsonb)`;
}

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
  return sql`SELECT jsonb_build_object(
    'id', e.id,
    'customerId', e.customer_id,
    'packageTypeId', e.package_type_id,
    'provenance', e.provenance,
    'nameEn', e.name_en,
    'nameAr', e.name_ar,
    'validityDays', e.validity_days,
    'listPrice', e.list_price::text,
    'pricePaid', e.price_paid::text,
    'discount', e.discount::text,
    'discountBps', e.discount_bps,
    'paidMethod', e.paid_method,
    'sellerEmployeeId', e.seller_employee_id,
    'sellerLinkedUserId', e.seller_linked_user_id,
    'soldBranchId', e.sold_branch_id,
    'soldAt', to_char(e.sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'soldBusinessDate', to_char(e.sold_business_date, 'YYYY-MM-DD'),
    'expiresOn', to_char(e.expires_on, 'YYYY-MM-DD'),
    'refundedAmount', e.refunded_amount::text,
    'revision', e.revision,
    'components', ${componentProjection()}
  ) AS detail
  FROM package_entitlements e
  WHERE e.company_id=${companyId} AND e.company_id=app_company_id()
    AND e.business_id=${businessId} AND e.id=${entitlementId}`;
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
  const [row] = await tx.execute<{ detail: PackageEntitlementDetail }>(
    packageEntitlementDetailStatement(companyId, businessId, entitlementId),
  );
  return row?.detail ?? null;
}
