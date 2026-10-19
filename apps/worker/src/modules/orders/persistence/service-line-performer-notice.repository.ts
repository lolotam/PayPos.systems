import { appendOutboxEvent, type Tx } from '@pospay/db';
import { serviceLinePerformersNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type { PerformerShare, PerformersChangeHistory } from '../domain/performers-change-notice.ts';
import type {
  PerformersChangeLineContext,
  PerformersChangeNoticeLine,
  PerformersChangeNoticeOutbox,
  PerformersChangeNoticeRepository,
} from '../ports/performers-change-notice.port.ts';

// تغيير المنفّذين ليس نهائيًا؛ تعديل لاحق أو تغيير ثانٍ أو إلغاء يرفع المراجعة قبل وصول المستهلك.
export const performersChangeMatchStatement = (
  line: PerformersChangeNoticeLine,
) => sql`SELECT l.id FROM service_lines l
  JOIN service_sessions s ON s.company_id = l.company_id AND s.business_id = l.business_id AND s.id = l.session_id
  WHERE l.company_id = ${line.companyId} AND l.id = ${line.lineId} AND l.business_id = ${line.businessId}
    AND l.session_id = ${line.sessionId} AND s.branch_id = ${line.branchId}
    AND s.business_date = ${line.businessDate}::date
    AND l.revision >= ${line.revision}`;

export const performersChangeHeaderStatement = (
  companyId: string,
  lineId: string,
  revision: number,
) => sql`SELECT previous_revision FROM service_line_performer_changes
  WHERE company_id = ${companyId} AND line_id = ${lineId} AND revision = ${revision}`;

export const performersChangeRowsStatement = (
  companyId: string,
  lineId: string,
  revision: number,
) => sql`SELECT r.side, r.employee_id, r.share_bps
  FROM service_line_performer_changes c
  JOIN service_line_performer_change_rows r
    ON r.company_id = c.company_id AND r.business_id = c.business_id AND r.change_id = c.id
  WHERE c.company_id = ${companyId} AND c.line_id = ${lineId} AND c.revision = ${revision}
  ORDER BY r.side, r.performer_ordinal`;

export const performersChangeContextStatement = (
  line: PerformersChangeNoticeLine,
) => sql`SELECT l.name_ar, l.name_en, s.business_timezone
  FROM service_lines l
  JOIN service_sessions s ON s.company_id = l.company_id AND s.business_id = l.business_id AND s.id = l.session_id
  WHERE l.company_id = ${line.companyId} AND l.id = ${line.lineId} AND l.business_id = ${line.businessId}
    AND l.session_id = ${line.sessionId} AND s.branch_id = ${line.branchId}`;

export function performersChangeClaimStatement(
  line: PerformersChangeNoticeLine,
  decision: Parameters<PerformersChangeNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO service_line_performer_notices
      (company_id, id, business_id, line_id, revision, source_event_id, decided_at, recipient_count)
      VALUES (${line.companyId}, ${decision.id}, ${line.businessId}, ${line.lineId}, ${line.revision},
        ${decision.sourceEventId}, ${decision.decidedAt.toISOString()}::timestamptz, ${decision.recipientCount})
      ON CONFLICT (company_id, line_id, revision) DO NOTHING RETURNING id`;
}

export function performersChangeRepository(tx: Tx): PerformersChangeNoticeRepository {
  return {
    matchesLine: async (line) =>
      (await tx.execute(performersChangeMatchStatement(line))).length === 1,
    readPerformerChange: async (companyId, lineId, revision) => {
      const [header] = await tx.execute<HeaderRow>(
        performersChangeHeaderStatement(companyId, lineId, revision),
      );
      if (header === undefined) return null;
      const rows = await tx.execute<ChangeRow>(
        performersChangeRowsStatement(companyId, lineId, revision),
      );
      return toHistory(header, rows);
    },
    readLineContext: async (line) => {
      const [row] = await tx.execute<ContextRow>(performersChangeContextStatement(line));
      return row === undefined ? null : toContext(row);
    },
    claim: async (line, decision) =>
      (await tx.execute(performersChangeClaimStatement(line, decision))).length === 1,
  };
}
export function performersChangeOutbox(tx: Tx): PerformersChangeNoticeOutbox {
  return {
    append: (id, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'service_session',
        aggregateId: payload.session_id,
        eventType: 'ServiceLinePerformersNoticeRequested',
        payload: serviceLinePerformersNoticeRequested.parse(payload),
      }),
  };
}
type HeaderRow = Record<string, unknown> & { previous_revision: number | string };
type ChangeRow = Record<string, unknown> & {
  side: string;
  employee_id: string;
  share_bps: number | string;
};
type ContextRow = Record<string, unknown> & {
  name_ar: string | null;
  name_en: string;
  business_timezone: string;
};
function toHistory(header: HeaderRow, rows: readonly ChangeRow[]): PerformersChangeHistory {
  return {
    previousRevision: Number(header.previous_revision),
    before: shares(rows, 'BEFORE'),
    after: shares(rows, 'AFTER'),
  };
}
function shares(rows: readonly ChangeRow[], side: 'BEFORE' | 'AFTER'): PerformerShare[] {
  return rows.filter((row) => row.side === side).map(toShare);
}
function toShare(row: ChangeRow): PerformerShare {
  return { employee_id: row.employee_id, share_bps: Number(row.share_bps) };
}
function toContext(row: ContextRow): PerformersChangeLineContext {
  return { nameAr: row.name_ar, nameEn: row.name_en, businessTimezone: row.business_timezone };
}
