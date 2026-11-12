import { customerPackageDetail, type CustomerPackageDetail } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';
import {
  CustomerPackageReadError,
  type CustomerPackageReads,
  type CustomerPackageScope,
} from './customer-packages.query.ts';

function componentProjection(): SQL {
  return sql`COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'service_id', c.service_id,
      'position', c.position,
      'name_en', c.name_en,
      'name_ar', c.name_ar,
      'list_price_snapshot', c.list_price_snapshot::text,
      'component_value', c.component_value::text,
      'sessions_total', c.sessions_total,
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
          'unit_value', s.unit_value::text
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
 * المفاتيح snake_case زي API contract عشان النتيجة تتقرأ من غير mapper.
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
    'customer_id', e.customer_id,
    'package_type_id', e.package_type_id,
    'provenance', e.provenance,
    'name_en', e.name_en,
    'name_ar', e.name_ar,
    'validity_days', e.validity_days,
    'list_price', e.list_price::text,
    'price_paid', e.price_paid::text,
    'discount', e.discount::text,
    'discount_bps', e.discount_bps,
    'paid_method', e.paid_method,
    'seller_employee_id', e.seller_employee_id,
    'seller_linked_user_id', e.seller_linked_user_id,
    'sold_branch_id', e.sold_branch_id,
    'sold_at', to_char(e.sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sold_business_date', to_char(e.sold_business_date, 'YYYY-MM-DD'),
    'expires_on', to_char(e.expires_on, 'YYYY-MM-DD'),
    'refunded_amount', e.refunded_amount::text,
    'revision', e.revision,
    'components', ${componentProjection()}
  ) AS detail
  FROM package_entitlements e
  WHERE e.company_id=${companyId} AND e.company_id=app_company_id()
    AND e.business_id=${businessId} AND e.id=${entitlementId}`;
}

/**
 * يقرأ تفاصيل باقة عميلة واحدة بشكل API contract: حقائق البيع والمكوّنات والجلسات.
 * القارئ ما بيفتحش معاملة ولا connection ولا بيكتب ولا بيقفل: المستدعي بيبعت
 * معاملة مستأجره جاهزة ونشاط متأكّد منه، والـ RLS هو خط الدفاع الأخير.
 *
 * @param tx معاملة المستأجر التي فتحها المستدعي
 * @param companyId شركة الباقة
 * @param businessId نشاط الباقة
 * @param entitlementId معرّف الاستحقاق
 * @returns تفاصيل الباقة بشكل CustomerPackageDetail، أو null لو المعرّف مش موجود أو تبع نشاط تاني أو شركة تانية
 */
export async function readPackageEntitlementDetail(
  tx: Tx,
  companyId: string,
  businessId: string,
  entitlementId: string,
): Promise<CustomerPackageDetail | null> {
  const [row] = await tx.execute<{ detail: CustomerPackageDetail }>(
    packageEntitlementDetailStatement(companyId, businessId, entitlementId),
  );
  return row?.detail ?? null;
}

export class CustomerPackageDetailQueryHandler {
  constructor(
    private readonly db: TenantWrappers,
    private readonly reads: CustomerPackageReads,
  ) {}

  async execute(scope: CustomerPackageScope, entitlementId: string): Promise<CustomerPackageDetail> {
    return this.db.withTenant(scope.companyId, async (tx) => {
      if (await this.reads.place(tx, scope) === null) throw new CustomerPackageReadError('FORBIDDEN');
      const detail = await readPackageEntitlementDetail(tx, scope.companyId, scope.businessId, entitlementId);
      if (detail === null || detail.customer_id !== scope.customerId) {
        throw new CustomerPackageReadError('PACKAGE_NOT_FOUND');
      }
      return customerPackageDetail.parse(detail);
    }, { userId: scope.userId });
  }
}
