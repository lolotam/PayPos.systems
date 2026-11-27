import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { DiscountConsumptionPort } from '../ports/discount-consumption.port.ts';
import { termsHash } from './terms-hash.adapter.ts';

type LockedRow = {
  id: string;
  request_id: string;
  session_id: string | null;
  branch_id: string;
  requested_by: string;
  requested_by_membership_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CONSUMED';
  expires_at: Date;
  terms_hash: string;
  consumed_line_id: string | null;
};

export function discountConsumption(
  tx: Tx,
  companyId: string,
  businessId: string,
): DiscountConsumptionPort {
  return {
    lock: async (proposalIds) => {
      const ids = [...new Set(proposalIds.map((id) => id.toLowerCase()))].sort();
      if (ids.length === 0) return [];
      const requestedIds = new Set(ids);
      const anyId = sql`ANY(ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`,`,
      )}]::uuid[])`;
      // شقيق الطلب يُقفل مع الطلبات المطلوبة: هو الذي أنشأ الزيارة، فحالته تتغير معنا أو لا تتغير.
      const rows = await tx.execute<LockedRow>(sql`
        SELECT dp.id, dp.request_id, dp.session_id, dp.branch_id, dp.requested_by,
               dp.requested_by_membership_id, dp.status, dp.expires_at, dp.terms_hash, dp.consumed_line_id
        FROM discount_proposals dp
        WHERE dp.company_id=${companyId}
          AND dp.business_id=${businessId}
          AND dp.kind='RECORD'
          AND (
            dp.id=${anyId}
            OR dp.request_id IN (
              SELECT dp2.request_id
              FROM discount_proposals dp2
              WHERE dp2.company_id=${companyId}
                AND dp2.business_id=${businessId}
                AND dp2.kind='RECORD'
                AND dp2.id=${anyId}
            )
          )
        ORDER BY dp.id FOR UPDATE`);
      const bound = await boundSessions(tx, companyId, businessId, rows);
      return rows
        .filter((row) => requestedIds.has(row.id.toLowerCase()))
        .map((row) => ({
          id: row.id,
          branch_id: row.branch_id,
          requested_by: row.requested_by,
          requested_by_membership_id: row.requested_by_membership_id,
          status: row.status,
          expires_at: new Date(row.expires_at),
          terms_hash: row.terms_hash.trim(),
          session_id: row.session_id,
          bound_session_id: row.session_id === null ? (bound.get(row.request_id) ?? null) : null,
        }));
    },
    consume: async (proposalId, lineId, hash, at) => {
      const moment = at.toISOString();
      const rows = await tx.execute<{
        id: string;
      }>(sql`UPDATE discount_proposals SET status='CONSUMED',consumed_line_id=${lineId},
        consumed_at=${moment}::timestamptz WHERE company_id=${companyId} AND business_id=${businessId} AND id=${proposalId}
        AND kind='RECORD' AND status='APPROVED' AND expires_at > ${moment}::timestamptz AND terms_hash=${hash} RETURNING id`);
      return rows.length > 0;
    },
    hash: termsHash(),
  };
}

/**
 * يربط كل طلب بزيارة جديدة أنشأها مقترح من نفس الطلب بعد استهلاكه.
 * القاعدة: سطرُ البند المستهلك هو ما يحدد الزيارة، فالزيارة تقرأ من صفه المحفوظ لا من التخمين.
 * وقسم الطلب على زيارتين يعني أن الطلب انقسم، فلا يُربط شيء.
 *
 * @param tx معاملة السطر نفسها
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط الذي أثبته tenancy
 * @param rows الطلبات المقفلة
 * @returns لكل طلب معرّف الزيارة التي أنشأها، وفارغ إن لم يستهلك أي طلب زيارةً
 */
async function boundSessions(
  tx: Tx,
  companyId: string,
  businessId: string,
  rows: readonly LockedRow[],
): Promise<Map<string, string>> {
  const consumed = rows.filter(
    (row) => row.session_id === null && row.status === 'CONSUMED' && row.consumed_line_id !== null,
  );
  const lineIds = [...new Set(consumed.map((row) => row.consumed_line_id as string))];
  if (lineIds.length === 0) return new Map();
  const lines = await tx.execute<{ id: string; session_id: string }>(sql`
    SELECT id, session_id FROM service_lines
    WHERE company_id=${companyId} AND business_id=${businessId}
      AND id=ANY(ARRAY[${sql.join(
        lineIds.map((id) => sql`${id}`),
        sql`,`,
      )}]::uuid[])`);
  const sessionByLine = new Map(
    lines.map((line) => [line.id.toLowerCase(), line.session_id.toLowerCase()]),
  );
  const sessionsByRequest = new Map<string, Set<string>>();
  for (const row of consumed) {
    const session = sessionByLine.get((row.consumed_line_id as string).toLowerCase());
    if (session === undefined) continue;
    const sessions = sessionsByRequest.get(row.request_id) ?? new Set<string>();
    sessions.add(session);
    sessionsByRequest.set(row.request_id, sessions);
  }
  const bound = new Map<string, string>();
  for (const [requestId, sessions] of sessionsByRequest) {
    const [only] = sessions;
    if (only !== undefined && sessions.size === 1) bound.set(requestId, only);
  }
  return bound;
}
