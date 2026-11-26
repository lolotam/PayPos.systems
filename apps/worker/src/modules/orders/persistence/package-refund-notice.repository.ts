import { appendOutboxEvent, type Tx } from '@pospay/db';
import { packageRefundNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  PackageRefundNoticeContext,
  PackageRefundNoticeOutbox,
  PackageRefundNoticeRefund,
  PackageRefundNoticeRepository,
} from '../ports/package-refund-notice.port.ts';

// سطر الاسترداد هو المصدر: لازم يطابق الحدث في الشركة والنشاط والفرع والاستحقاق والمكوّن
// والجلسات والمبلغ والنسخة واللحظة، واليوم التقويمي لازم يبقى يوم الفرع وقت الاسترداد.
export const packageRefundMatchStatement = (refund: PackageRefundNoticeRefund) => sql`
  SELECT f.id FROM package_refunds f
  JOIN branches b ON b.company_id = f.company_id AND b.business_id = f.business_id AND b.id = f.branch_id
  JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
  WHERE f.company_id = ${refund.companyId} AND f.id = ${refund.refundId}
    AND f.business_id = ${refund.businessId} AND f.entitlement_id = ${refund.entitlementId}
    AND f.component_id = ${refund.componentId} AND f.branch_id = ${refund.branchId}
    AND f.sessions = ${refund.sessions} AND f.amount = ${refund.amount}::numeric
    AND f.entitlement_revision = ${refund.entitlementRevision}
    AND f.refunded_at = ${refund.refundedAt}::timestamptz
    AND to_char(f.refunded_at AT TIME ZONE COALESCE(b.timezone, bu.timezone), 'YYYY-MM-DD') = ${refund.businessDate}
    AND EXISTS (
      SELECT 1 FROM package_entitlements e
      WHERE e.company_id = f.company_id AND e.business_id = f.business_id AND e.id = f.entitlement_id
    )`;

// اسم الباقة والمنطقة الزمنية من الاستحقاق المحروس؛ سبب الاسترداد ما يتقراش أبدًا هنا.
export const packageRefundContextStatement = (refund: PackageRefundNoticeRefund) => sql`
  SELECT e.name_ar, e.name_en, COALESCE(b.timezone, bu.timezone) AS business_timezone
  FROM package_entitlements e
  JOIN branches b ON b.company_id = e.company_id AND b.business_id = e.business_id AND b.id = ${refund.branchId}
  JOIN businesses bu ON bu.company_id = b.company_id AND bu.id = b.business_id
  WHERE e.company_id = ${refund.companyId} AND e.business_id = ${refund.businessId}
    AND e.id = ${refund.entitlementId}`;

export function packageRefundClaimStatement(
  refund: PackageRefundNoticeRefund,
  decision: Parameters<PackageRefundNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO package_refund_notices
      (company_id, id, business_id, refund_id, source_event_id, decided_at, recipient_count)
      VALUES (${refund.companyId}, ${decision.id}, ${refund.businessId}, ${refund.refundId},
        ${decision.sourceEventId}, ${decision.decidedAt.toISOString()}::timestamptz, ${decision.recipientCount})
      ON CONFLICT (company_id, refund_id) DO NOTHING RETURNING id`;
}

export function packageRefundRepository(tx: Tx): PackageRefundNoticeRepository {
  return {
    matchesRefund: async (refund) =>
      (await tx.execute(packageRefundMatchStatement(refund))).length === 1,
    readRefundContext: async (refund) => {
      const [row] = await tx.execute<ContextRow>(packageRefundContextStatement(refund));
      return row === undefined ? null : toContext(row);
    },
    claim: async (refund, decision) =>
      (await tx.execute(packageRefundClaimStatement(refund, decision))).length === 1,
  };
}

export function packageRefundOutbox(tx: Tx): PackageRefundNoticeOutbox {
  return {
    append: (id, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'package_entitlement',
        aggregateId: payload.entitlement_id,
        eventType: 'PackageRefundNoticeRequested',
        payload: packageRefundNoticeRequested.parse(payload),
      }),
  };
}

type ContextRow = Record<string, unknown> & {
  name_ar: string | null;
  name_en: string;
  business_timezone: string;
};

function toContext(row: ContextRow): PackageRefundNoticeContext {
  return {
    packageNameAr: row.name_ar,
    packageNameEn: row.name_en,
    businessTimezone: row.business_timezone,
  };
}
