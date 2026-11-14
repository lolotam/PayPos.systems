import {
  packageSaleRefusalCode,
  packageSaleStatus,
  type PackageSaleRefusalCode,
  type PackageSaleStatus,
} from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { errorMessages } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { ApiError } from '../../../shared/errors.ts';

export interface PackageSaleLookup {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  saleRequestId: string;
}

export function packageSaleStatusStatement(actor: PackageSaleLookup) {
  // شاشة تفاصيل باقة العميلة (42-4) بتتابع نتيجة البيع لمنشئ الطلب بس.
  return sql`SELECT status,entitlement_id,error_code,error_details
    FROM package_sale_requests
    WHERE company_id=${actor.companyId} AND id=${actor.saleRequestId}
      AND business_id=${actor.businessId} AND branch_id=${actor.branchId}
      AND recorded_by=${actor.userId}`;
}

function soldPackageEntitlementStatement(actor: PackageSaleLookup, entitlementId: string | null) {
  return sql`SELECT jsonb_build_object(
    'id', e.id,
    'business_id', e.business_id,
    'customer_id', e.customer_id,
    'package_type_id', e.package_type_id,
    'sold_branch_id', e.sold_branch_id,
    'name_en', e.name_en,
    'name_ar', e.name_ar,
    'validity_days', e.validity_days,
    'list_price', e.list_price::text,
    'price_paid', e.price_paid::text,
    'discount', e.discount::text,
    'discount_bps', e.discount_bps,
    'paid_method', e.paid_method,
    'seller_employee_id', e.seller_employee_id,
    'sold_at', to_char(e.sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sold_business_date', to_char(e.sold_business_date, 'YYYY-MM-DD'),
    'late', e.late,
    'expires_on', to_char(e.expires_on, 'YYYY-MM-DD'),
    'refunded_amount', e.refunded_amount::text,
    'revision', e.revision,
    'components', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'service_id', c.service_id,
        'position', c.position,
        'name_en', c.name_en,
        'name_ar', c.name_ar,
        'list_price_snapshot', c.list_price_snapshot::text,
        'component_value', c.component_value::text,
        'sessions_total', c.sessions_total
      ) ORDER BY c.position)
      FROM package_components c
      WHERE c.company_id=e.company_id AND c.business_id=e.business_id
        AND c.entitlement_id=e.id
    ), '[]'::jsonb)
  ) AS entitlement
  FROM package_entitlements e
  WHERE e.company_id=${actor.companyId} AND e.company_id=app_company_id()
    AND e.business_id=${actor.businessId} AND e.id=${entitlementId}`;
}

export function packageSaleStatusQuery(
  database: Pick<TenantWrappers, 'withTenant'>,
  actor: PackageSaleLookup,
): Promise<PackageSaleStatus> {
  return database.withTenant(
    actor.companyId,
    async (tx) => {
      const [request] = await tx.execute<{
        status: 'pending' | 'completed' | 'failed';
        entitlement_id: string | null;
        error_code: string | null;
        error_details: unknown;
      }>(packageSaleStatusStatement(actor));
      if (request === undefined) throw new ApiError('PACKAGE_SALE_REQUEST_NOT_FOUND');
      if (request.status === 'pending') return packageSaleStatus.parse({ status: 'pending' });
      if (request.status === 'completed') {
        const [row] = await tx.execute<{ entitlement: unknown }>(
          soldPackageEntitlementStatement(actor, request.entitlement_id),
        );
        return packageSaleStatus.parse({ status: 'completed', entitlement: row?.entitlement });
      }
      const storedCode = request.error_code;
      const code = packageSaleRefusalCode.options.includes(storedCode as PackageSaleRefusalCode)
        ? (storedCode as PackageSaleRefusalCode)
        : 'PACKAGE_SALE_FAILED';
      const details = request.error_details;
      return packageSaleStatus.parse({
        status: 'failed',
        error: {
          code,
          ...errorMessages(code),
          ...(details === null || details === undefined ? {} : { details }),
        },
      });
    },
    { userId: actor.userId },
  );
}

// الغلاف ده موجود عشان الـ controller والـ module يقدروا يحقنوا الـ database في استعلام حالة البيع.
export class PackageSaleStatusQuery {
  constructor(private readonly database: Pick<TenantWrappers, 'withTenant'>) {}

  execute(actor: PackageSaleLookup): Promise<PackageSaleStatus> {
    return packageSaleStatusQuery(this.database, actor);
  }
}
