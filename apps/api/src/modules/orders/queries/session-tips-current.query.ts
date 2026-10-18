import { sessionTips, type SessionTips } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

export interface SessionTipsScope {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  sessionId: string;
}

/** الزيارة مش موجودة في نطاق الفرع؛ الـ HTTP يوحّد الجسم مع كتابة البقشيش. */
export class SessionTipsReadError extends Error {
  readonly code = 'SESSION_NOT_FOUND' as const;
  constructor() { super('SESSION_NOT_FOUND'); }
}

type TipReadRow = {
  session_id: string | null;
  revision: number | string | null;
  employee_id: string | null;
  method: string | null;
  amount: string | null;
  total_cash: string;
  total_card: string;
};

// شاشة بقشيش الاستقبال لمن يسجّل الزيارة: المراجعة الحالية ومجموعتها فقط، بلا عميلة أو هاتف.
export function sessionTipsCurrentStatement(scope: SessionTipsScope) {
  return sql`WITH visit AS (
    SELECT s.company_id, s.business_id, s.id
    FROM service_sessions s
    WHERE s.company_id = ${scope.companyId} AND s.company_id = app_company_id()
      AND s.business_id = ${scope.businessId} AND s.branch_id = ${scope.branchId} AND s.id = ${scope.sessionId})
  SELECT visit.id AS session_id, coalesce(rev.revision, 0) AS revision, tip.employee_id, tip.method, tip.amount,
    trim(to_char(coalesce(sum(tip.amount_value) FILTER (WHERE tip.method = 'CASH') OVER (), 0), '99999999990.000')) AS total_cash,
    trim(to_char(coalesce(sum(tip.amount_value) FILTER (WHERE tip.method = 'CARD') OVER (), 0), '99999999990.000')) AS total_card
  FROM visit
  LEFT JOIN LATERAL (
    SELECT r.id, r.revision FROM session_tip_revisions r
    WHERE r.company_id = visit.company_id AND r.session_id = visit.id
    ORDER BY r.revision DESC LIMIT 1) rev ON true
  LEFT JOIN LATERAL (
    SELECT t.employee_id, t.method, trim(to_char(t.amount, '99999999990.000')) AS amount, t.amount AS amount_value
    FROM session_tips t
    WHERE t.company_id = visit.company_id AND t.business_id = visit.business_id
      AND t.session_id = visit.id AND t.revision_id = rev.id) tip ON rev.id IS NOT NULL
  ORDER BY lower(tip.employee_id::text) NULLS FIRST, tip.method NULLS FIRST`;
}

function currentSet(rows: readonly TipReadRow[]): SessionTips {
  const head = rows[0];
  if (head?.session_id == null) throw new SessionTipsReadError();
  const tips: SessionTips['tips'] = [];
  for (const row of rows) {
    if (row.employee_id === null || row.method === null || row.amount === null) continue;
    tips.push({ employee_id: row.employee_id, method: row.method as SessionTips['tips'][number]['method'], amount: row.amount });
  }
  return sessionTips.parse({
    revision: Number(head.revision ?? 0),
    tips,
    total_cash: head.total_cash,
    total_card: head.total_card,
  });
}

export class SessionTipsCurrentQuery {
  constructor(private readonly db: TenantWrappers) {}
  async execute(scope: SessionTipsScope): Promise<SessionTips> {
    return this.db.withTenant(scope.companyId, async (tx) => {
      const rows = await tx.execute<TipReadRow>(sessionTipsCurrentStatement(scope));
      return currentSet(rows);
    }, { userId: scope.userId });
  }
}
