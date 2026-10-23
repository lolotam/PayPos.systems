import {
  discountProposalRequestQuery,
  requesterDiscountProposalList,
  type RequesterDiscountProposalList,
} from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import { SessionDayReadError, type SessionDayScope } from './branch-day-service-sessions.query.ts';

/** تثبيت تبعية الفرع للنشاط، وإعادة فحص إذن التسجيل، قبل قراءة طلبات صاحبها. */
export interface DiscountProposalPlaceAccess {
  /**
   * يثبت أن الفرع تابع للنشاط داخل الشركة.
   *
   * @param tx معاملة القراءة
   * @param scope الشركة والنشاط والفرع والطالبة
   * @returns هل الفرع داخل النشاط
   */
  place(tx: Tx, scope: SessionDayScope): Promise<boolean>;
  /**
   * يعيد إذن التسجيل والمنع والميزة والعضويات عند اللحظة المحقونة.
   *
   * @param tx معاملة القراءة
   * @param scope الشركة والنشاط والفرع والطالبة
   * @param at اللحظة المحقونة بعد الانتظار
   * @returns سلطة التسجيل ومنعها والميزة والعضويات المتاحة في الفرع
   */
  access(tx: Tx, scope: SessionDayScope, at: Date): Promise<{
    record: boolean;
    denied: boolean;
    feature: boolean;
    membership_ids: readonly string[];
  }>;
}

type RequesterRow = {
  id: string;
  request_id: string;
  input_index: number;
  status: string;
  session_id: string | null;
  occurred_at: string;
  service_id: string;
  service_name_en: string;
  service_name_ar: string | null;
  list_price: string;
  price: string;
  discount: string;
  net: string;
  effective_bps: number;
  expires_at: string;
  terms_hash: string;
  decided_by: string | null;
  decided_via: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  consumed_line_id: string | null;
  decider_name_ar: string | null;
  decider_name_en: string | null;
  decider_role: string | null;
  decider_role_is_system: boolean | null;
  decider_role_name_ar: string | null;
  decider_role_name_en: string | null;
};

const occurred = sql`to_char(d.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const expired = sql`to_char(d.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const decidedAt = sql`to_char(d.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// شاشة طلبات الطالبة: اقتراحات طلبها هي فقط، بحالة مشتقّة من وقت الانتهاء (D-7) وبلا كاشف وجود.
export function requesterDiscountProposalsStatement(scope: SessionDayScope, requestId: string, now: Date) {
  return sql`SELECT d.id,d.request_id,d.input_index,
    CASE WHEN d.status IN ('PENDING','APPROVED') AND d.expires_at <= ${now.toISOString()}::timestamptz THEN 'EXPIRED' ELSE d.status END AS status,
    d.session_id,${occurred} AS occurred_at,d.service_id,d.service_name_en,d.service_name_ar,
    d.terms->>'list_price' AS list_price,d.terms->>'price' AS price,d.terms->>'discount' AS discount,d.terms->>'net' AS net,
    d.effective_bps,${expired} AS expires_at,d.terms_hash,
    d.decided_by,d.decided_via,${decidedAt} AS decided_at,d.reject_reason,d.consumed_line_id,
    d.decider_name_ar,d.decider_name_en,d.decider_role,d.decider_role_is_system,d.decider_role_name_ar,d.decider_role_name_en
    FROM discount_proposals d
    WHERE d.company_id=${scope.companyId} AND d.business_id=${scope.businessId} AND d.branch_id=${scope.branchId}
      AND d.request_id=${requestId} AND d.requested_by=${scope.userId} AND d.kind='RECORD'
    ORDER BY d.input_index`;
}

function deciderSnapshot(row: RequesterRow) {
  return {
    nameAr: row.decider_name_ar,
    nameEn: row.decider_name_en,
    role: row.decider_role,
    roleIsSystem: row.decider_role_is_system,
    roleNameAr: row.decider_role_name_ar,
    roleNameEn: row.decider_role_name_en,
  };
}

function toItem(row: RequesterRow) {
  const item = {
    kind: 'RECORD' as const,
    id: row.id,
    request_id: row.request_id,
    input_index: row.input_index,
    status: row.status,
    session_id: row.session_id,
    occurred_at: row.occurred_at,
    service_id: row.service_id,
    service_name_en: row.service_name_en,
    service_name_ar: row.service_name_ar,
    list_price: row.list_price,
    price: row.price,
    discount: row.discount,
    net: row.net,
    effective_bps: row.effective_bps,
    expires_at: row.expires_at,
    terms_hash: row.terms_hash,
  };
  if (row.decided_by === null) return item;
  return {
    ...item,
    decided_label_ar: editorLabel('ar', deciderSnapshot(row)),
    decided_label_en: editorLabel('en', deciderSnapshot(row)),
    ...(row.decided_via === null ? {} : { decided_via: row.decided_via === 'PIN' ? ('PIN' as const) : ('REMOTE' as const) }),
    ...(row.decided_at === null ? {} : { decided_at: row.decided_at }),
    ...(row.reject_reason === null ? {} : { reject_reason: row.reject_reason }),
    ...(row.consumed_line_id === null ? {} : { consumed_line_id: row.consumed_line_id }),
  };
}

export class RequesterDiscountProposalsQuery {
  constructor(
    private readonly db: TenantWrappers,
    private readonly access: DiscountProposalPlaceAccess,
    private readonly clock: { now(): Date },
  ) {}

  async execute(scope: SessionDayScope, input: unknown): Promise<RequesterDiscountProposalList> {
    const query = discountProposalRequestQuery.parse(input);
    return this.db.withTenant(scope.companyId, async (tx) => {
      if (!await this.access.place(tx, scope)) throw new SessionDayReadError('FORBIDDEN');
      const now = this.clock.now();
      const access = await this.access.access(tx, scope, now);
      if (access.denied || !access.record || access.membership_ids.length === 0) throw new SessionDayReadError('FORBIDDEN');
      if (!access.feature) throw new SessionDayReadError('FEATURE_DISABLED');
      const rows = await tx.execute<RequesterRow>(requesterDiscountProposalsStatement(scope, query.request_id, now));
      return requesterDiscountProposalList.parse({ items: rows.map(toItem) });
    }, { userId: scope.userId });
  }
}
