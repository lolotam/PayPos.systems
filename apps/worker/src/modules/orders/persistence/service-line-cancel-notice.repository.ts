import { appendOutboxEvent, type Tx } from '@pospay/db';
import { serviceLineCancelNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  LineCancelHistory,
  LineCancelLineContext,
  LineCancelNoticeLine,
  LineCancelNoticeOutbox,
  LineCancelNoticeRepository,
} from '../ports/line-cancel-notice.port.ts';

// تاريخ الحدث يُطابق تاريخ الزيارة قبل حجز الدفتر؛ تاريخ آخر يثبّت جرساً لا يستبدله تسليم لاحق.
export const lineCancelMatchStatement = (
  line: LineCancelNoticeLine,
) => sql`SELECT l.id FROM service_lines l
  JOIN service_sessions s ON s.company_id = l.company_id AND s.business_id = l.business_id AND s.id = l.session_id
  WHERE l.company_id = ${line.companyId} AND l.id = ${line.lineId} AND l.business_id = ${line.businessId}
    AND l.session_id = ${line.sessionId} AND s.branch_id = ${line.branchId}
    AND l.status = 'CANCELLED' AND l.revision = ${line.revision}
    AND s.business_date = ${line.businessDate}::date`;

// numeric قد يصل كرقم؛ القالب يشترط النص القانوني بثلاث خانات دون تحويل حسابي.
export const cancellationStatement = (companyId: string, lineId: string) => sql`
  SELECT revision, btrim(to_char(previous_net, '99999999990.000')) AS previous_net
  FROM service_line_cancellations
  WHERE company_id = ${companyId} AND line_id = ${lineId}`;

export const lineCancelContextStatement = (
  line: LineCancelNoticeLine,
) => sql`SELECT l.name_ar, l.name_en, s.business_timezone
  FROM service_lines l
  JOIN service_sessions s ON s.company_id = l.company_id AND s.business_id = l.business_id AND s.id = l.session_id
  WHERE l.company_id = ${line.companyId} AND l.id = ${line.lineId} AND l.business_id = ${line.businessId}
    AND l.session_id = ${line.sessionId} AND s.branch_id = ${line.branchId}`;

export function lineCancelClaimStatement(
  line: LineCancelNoticeLine,
  decision: Parameters<LineCancelNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO service_line_cancel_notices
      (company_id, id, business_id, line_id, revision, source_event_id, decided_at, recipient_count)
      VALUES (${line.companyId}, ${decision.id}, ${line.businessId}, ${line.lineId}, ${line.revision},
        ${decision.sourceEventId}, ${decision.decidedAt.toISOString()}::timestamptz, ${decision.recipientCount})
      ON CONFLICT (company_id, line_id, revision) DO NOTHING RETURNING id`;
}

export function lineCancelRepository(tx: Tx): LineCancelNoticeRepository {
  return {
    matchesLine: async (line) => (await tx.execute(lineCancelMatchStatement(line))).length === 1,
    readCancellation: async (companyId, lineId) => {
      const [row] = await tx.execute<HistoryRow>(cancellationStatement(companyId, lineId));
      return row === undefined ? null : toHistory(row);
    },
    readLineContext: async (line) => {
      const [row] = await tx.execute<ContextRow>(lineCancelContextStatement(line));
      return row === undefined ? null : toContext(row);
    },
    claim: async (line, decision) =>
      (await tx.execute(lineCancelClaimStatement(line, decision))).length === 1,
  };
}
export function lineCancelOutbox(tx: Tx): LineCancelNoticeOutbox {
  return {
    append: (id, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'service_session',
        aggregateId: payload.session_id,
        eventType: 'ServiceLineCancelNoticeRequested',
        payload: serviceLineCancelNoticeRequested.parse(payload),
      }),
  };
}
type HistoryRow = Record<string, unknown> & {
  revision: number | string;
  previous_net: string;
};
type ContextRow = Record<string, unknown> & {
  name_ar: string | null;
  name_en: string;
  business_timezone: string;
};
function toHistory(row: HistoryRow): LineCancelHistory {
  return { revision: Number(row.revision), previousNet: row.previous_net };
}
function toContext(row: ContextRow): LineCancelLineContext {
  return { nameAr: row.name_ar, nameEn: row.name_en, businessTimezone: row.business_timezone };
}
