import { appendOutboxEvent, type Tx } from '@pospay/db';
import { lateServiceSessionNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  LateNoticeRepository,
  LateNoticeOutbox,
  LateNoticeSession,
} from '../ports/late-service-session-notice.port.ts';

export const sessionNoticeMatchStatement = (
  session: LateNoticeSession,
) => sql`SELECT id FROM service_sessions
  WHERE company_id=${session.companyId} AND id=${session.sessionId} AND business_id=${session.businessId}
    AND branch_id=${session.branchId} AND business_date=${session.businessDate}::date
    AND business_timezone=${session.businessTimezone}`;

export function lateNoticeClaimStatement(
  session: LateNoticeSession,
  decision: Parameters<LateNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO late_service_session_notices
        (company_id,id,business_id,session_id,source_event_id,decided_at,recipient_count)
        VALUES(${session.companyId},${decision.id},${session.businessId},${session.sessionId},${decision.sourceEventId},
          ${decision.decidedAt.toISOString()}::timestamptz,${decision.recipientCount})
        ON CONFLICT(company_id,session_id) DO NOTHING RETURNING id`;
}

export function lateNoticeRepository(tx: Tx): LateNoticeRepository {
  return {
    matchesSession: async (session) =>
      (await tx.execute(sessionNoticeMatchStatement(session))).length === 1,
    claim: async (session, decision) => {
      const rows = await tx.execute(lateNoticeClaimStatement(session, decision));
      return rows.length === 1;
    },
  };
}
export function lateNoticeOutbox(tx: Tx): LateNoticeOutbox {
  return {
    append: (id, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'service_session',
        aggregateId: payload.session_id,
        eventType: 'LateServiceSessionNoticeRequested',
        payload: lateServiceSessionNoticeRequested.parse(payload),
      }),
  };
}
