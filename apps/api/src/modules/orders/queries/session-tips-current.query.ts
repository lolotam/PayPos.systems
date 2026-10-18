import { sessionTips, type SessionTips } from '@pospay/contracts';
import type { TenantWrappers, Tx } from '@pospay/db';
import { moneyToString, parseMoney, sumTipTotalsByMethod, type Money } from '@pospay/domain';
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

export interface SessionTipsCurrentReads {
  /** يعيد إذن record:service-sessions:branch على الفرع في اللحظة المعطاة بلا قفل صف. */
  access(tx: Tx, scope: SessionTipsScope, at: Date): Promise<{ record: boolean; denied: boolean; feature: boolean; membership_ids: readonly string[] }>;
}

type TipReadRow = {
  session_id: string | null;
  revision: number | string | null;
  employee_id: string | null;
  method: string | null;
  amount: string | null;
};

// شاشة بقشيش الاستقبال لمن يسجّل الزيارة: المراجعة الحالية ومجموعتها فقط، بلا عميلة أو هاتف.
export function sessionTipsCurrentStatement(scope: SessionTipsScope) {
  return sql`WITH visit AS (
    SELECT s.company_id, s.business_id, s.id
    FROM service_sessions s
    WHERE s.company_id = ${scope.companyId} AND s.company_id = app_company_id()
      AND s.business_id = ${scope.businessId} AND s.branch_id = ${scope.branchId} AND s.id = ${scope.sessionId})
  SELECT visit.id AS session_id, coalesce(rev.revision, 0) AS revision, tip.employee_id, tip.method, tip.amount
  FROM visit
  LEFT JOIN LATERAL (
    SELECT r.id, r.revision FROM session_tip_revisions r
    WHERE r.company_id = visit.company_id AND r.session_id = visit.id
    ORDER BY r.revision DESC LIMIT 1) rev ON true
  LEFT JOIN LATERAL (
    SELECT t.employee_id, t.method, t.amount::text AS amount
    FROM session_tips t
    WHERE t.company_id = visit.company_id AND t.business_id = visit.business_id
      AND t.session_id = visit.id AND t.revision_id = rev.id) tip ON rev.id IS NOT NULL
  ORDER BY lower(tip.employee_id::text) NULLS FIRST, tip.method NULLS FIRST`;
}

function currentSet(rows: readonly TipReadRow[]): SessionTips {
  const head = rows[0];
  if (head?.session_id == null) throw new SessionTipsReadError();
  const tips: SessionTips['tips'] = [];
  const entries: { method: 'CASH' | 'CARD'; amount: Money }[] = [];
  for (const row of rows) {
    if (row.employee_id === null || row.method === null || row.amount === null) continue;
    const amount = parseMoney(row.amount.trim());
    const method = row.method as SessionTips['tips'][number]['method'];
    tips.push({ employee_id: row.employee_id, method, amount: moneyToString(amount) });
    if (method === 'CASH' || method === 'CARD') entries.push({ method, amount });
  }
  return sessionTips.parse({ revision: Number(head.revision ?? 0), tips, ...sumTipTotalsByMethod(entries) });
}

export class SessionTipsCurrentQuery {
  constructor(private readonly db: TenantWrappers, private readonly reads: SessionTipsCurrentReads,
    private readonly clock: { now(): Date }) {}
  async execute(scope: SessionTipsScope): Promise<SessionTips> {
    return this.db.withTenant(scope.companyId, async (tx) => {
      const rows = await tx.execute<TipReadRow>(sessionTipsCurrentStatement(scope));
      const access = await this.reads.access(tx, scope, this.clock.now());
      // فقدان record أو DENY أو انتهاء العضوية بعد الحارس يطلع نفس رفض الزيارة المجهولة، بلا قفل وبلا معلومة زيادة
      if (access.denied || !access.record || access.membership_ids.length === 0) throw new SessionTipsReadError();
      return currentSet(rows);
    }, { userId: scope.userId });
  }
}
