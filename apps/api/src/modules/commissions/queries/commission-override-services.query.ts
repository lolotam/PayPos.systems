import {
  commissionOverrideServiceItem,
  commissionOverrideServiceList,
  type CommissionOverrideServiceList,
  type CommissionOverrideServiceListQuery,
} from '@pospay/contracts';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import {
  CommissionServiceOverrideReadError,
  type CommissionOverrideServicePage,
  type CommissionServiceOverrideListReads,
} from './commission-service-overrides.query.ts';

/** نطاق قراءة شاشة التجاوزات: الشركة والمستخدم البشري والنشاط والموظفة. */
export interface CommissionOverrideServiceScope {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly employeeId: string;
}

type CurrentOverrideRow = {
  readonly id: string;
  readonly service_id: string;
  readonly rule: unknown;
  readonly effective_from: string;
  readonly created_at: string;
};

// تاريخ اليوم بتوقيت النشاط، محسوب في الداتابيز جوه نفس معاملة القراءة — نفس قاعدة القائمة.
const businessToday = (timeZone: string) => sql`(CURRENT_TIMESTAMP AT TIME ZONE ${timeZone})::date`;

/**
 * جملة التجاوز الحالي لكل خدمة من خدمات الصفحة — تعريف `is_current` نفسه في قائمة FR-013:
 * المؤهّل بتاريخ اليوم بتوقيت النشاط والأحدث بين المؤهلين بـ (created_at, id).
 */
export function commissionOverrideCurrentStatement(
  scope: CommissionOverrideServiceScope,
  serviceIds: readonly string[],
  timeZone: string,
) {
  return sql`SELECT o.id,o.service_id,
    CASE o.rule_kind
      WHEN 'PCT' THEN jsonb_build_object('kind',o.rule_kind,'value',o.rule_pct_bps)
      WHEN 'FIXED' THEN jsonb_build_object('kind',o.rule_kind,'value',o.rule_fixed_amount::text)
      ELSE jsonb_build_object('kind',o.rule_kind) END AS rule,
    to_char(o.effective_from,'YYYY-MM-DD') AS effective_from,
    to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
    FROM commission_service_overrides o
    WHERE o.company_id = ${scope.companyId} AND o.business_id = ${scope.businessId}
      AND o.employee_id = ${scope.employeeId}
      AND o.service_id = ANY(ARRAY[${sql.join(
        serviceIds.map((serviceId) => sql`${serviceId}`),
        sql`,`,
      )}]::uuid[])
      AND o.effective_from <= ${businessToday(timeZone)}
      AND NOT EXISTS (
        SELECT 1 FROM commission_service_overrides c
        WHERE c.company_id = o.company_id AND c.business_id = o.business_id
          AND c.employee_id = o.employee_id AND c.service_id = o.service_id
          AND c.effective_from <= ${businessToday(timeZone)}
          AND (c.created_at, c.id) > (o.created_at, o.id)
      )`;
}

/**
 * يقرأ جدول شاشة «عمولة خاصة للخدمات» (FR-013a): كل خدمة النشاط والتجاوز الحالي للموظفة أو `null`،
 * والرفض بترتيب قائمة FR-013 على معاملة واحدة — الصلاحية الموحّدة فالميزة فوجود الموظفة.
 */
export async function listCommissionOverrideServices(
  tx: Tx,
  reads: CommissionServiceOverrideListReads,
  scope: CommissionOverrideServiceScope,
  query: CommissionOverrideServiceListQuery,
): Promise<CommissionOverrideServiceList> {
  const refused = await reads.access(scope.companyId, scope.userId, scope.businessId);
  if (refused !== null) throw new CommissionServiceOverrideReadError(refused);
  if (!(await reads.employeeExists(scope.companyId, scope.businessId, scope.employeeId))) {
    throw new CommissionServiceOverrideReadError('EMPLOYEE_NOT_FOUND');
  }
  const timeZone = await reads.timeZone(scope.companyId, scope.businessId);
  if (timeZone === null) throw new CommissionServiceOverrideReadError('FORBIDDEN');
  const page: CommissionOverrideServicePage = await reads.services(
    scope.companyId,
    scope.businessId,
    query,
  );
  const current =
    page.items.length === 0
      ? []
      : await tx.execute<CurrentOverrideRow>(
          commissionOverrideCurrentStatement(
            scope,
            page.items.map((item) => item.id),
            timeZone,
          ),
        );
  const currentByService = new Map(current.map((row) => [row.service_id, row]));
  const items = page.items.map((item) => {
    const override = currentByService.get(item.id);
    return commissionOverrideServiceItem.parse({
      service_id: item.id,
      name_ar: item.name_ar,
      name_en: item.name_en,
      closed_at: item.closed_at,
      service_rule: item.rule,
      price: item.price,
      current_override:
        override === undefined
          ? null
          : {
              id: override.id,
              rule: override.rule,
              effective_from: override.effective_from,
              created_at: override.created_at,
            },
    });
  });
  return commissionOverrideServiceList.parse({ items, next_cursor: page.next_cursor });
}
