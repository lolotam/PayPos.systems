import { appendOutboxEvent, type Tx } from '@pospay/db';
import { serviceLineEditNoticeRequested } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import type {
  PriceEditLineContext,
  PriceEditNoticeLine,
  PriceEditNoticeOutbox,
  PriceEditNoticeRepository,
  PriceEditSnapshot,
} from '../ports/price-edit-notice.port.ts';

export const lineNoticeMatchStatement = (
  line: PriceEditNoticeLine,
) => sql`SELECT l.id FROM service_lines l
  JOIN service_sessions s ON s.company_id = l.company_id AND s.business_id = l.business_id AND s.id = l.session_id
  WHERE l.company_id = ${line.companyId} AND l.id = ${line.lineId} AND l.business_id = ${line.businessId}
    AND l.session_id = ${line.sessionId} AND s.branch_id = ${line.branchId} AND l.revision >= ${line.revision}`;

// numeric قد يصل كرقم؛ القالب يشترط النص القانوني بثلاث خانات دون تحويل حسابي.
export const editSnapshotStatement = (companyId: string, lineId: string, revision: number) => sql`
  SELECT editor_name_ar, editor_name_en, editor_role, editor_role_is_system,
    editor_role_name_ar, editor_role_name_en,
    btrim(to_char(previous_net, '99999999990.000')) AS previous_net,
    btrim(to_char(new_net, '99999999990.000')) AS new_net
  FROM service_line_edits
  WHERE company_id = ${companyId} AND line_id = ${lineId} AND revision = ${revision}`;

export const lineContextStatement = (
  line: PriceEditNoticeLine,
) => sql`SELECT l.name_ar, l.name_en, s.business_timezone
  FROM service_lines l
  JOIN service_sessions s ON s.company_id = l.company_id AND s.business_id = l.business_id AND s.id = l.session_id
  WHERE l.company_id = ${line.companyId} AND l.id = ${line.lineId} AND l.business_id = ${line.businessId}
    AND l.session_id = ${line.sessionId} AND s.branch_id = ${line.branchId}`;

export function lineNoticeClaimStatement(
  line: PriceEditNoticeLine,
  decision: Parameters<PriceEditNoticeRepository['claim']>[1],
) {
  return sql`INSERT INTO service_line_edit_notices
      (company_id, id, business_id, session_id, line_id, revision, source_event_id, decided_at, recipient_count)
      VALUES (${line.companyId}, ${decision.id}, ${line.businessId}, ${line.sessionId}, ${line.lineId}, ${line.revision},
        ${decision.sourceEventId}, ${decision.decidedAt.toISOString()}::timestamptz, ${decision.recipientCount})
      ON CONFLICT (company_id, line_id, revision) DO NOTHING RETURNING id`;
}

export function priceEditRepository(tx: Tx): PriceEditNoticeRepository {
  return {
    matchesLine: async (line) => (await tx.execute(lineNoticeMatchStatement(line))).length === 1,
    readEditSnapshot: async (companyId, lineId, revision) => {
      const [row] = await tx.execute<SnapshotRow>(
        editSnapshotStatement(companyId, lineId, revision),
      );
      return row === undefined ? null : toSnapshot(row);
    },
    readLineContext: async (line) => {
      const [row] = await tx.execute<ContextRow>(lineContextStatement(line));
      return row === undefined ? null : toContext(row);
    },
    claim: async (line, decision) =>
      (await tx.execute(lineNoticeClaimStatement(line, decision))).length === 1,
  };
}
export function priceEditOutbox(tx: Tx): PriceEditNoticeOutbox {
  return {
    append: (id, payload) =>
      appendOutboxEvent(tx, id, {
        aggregateType: 'service_session',
        aggregateId: payload.session_id,
        eventType: 'ServiceLineEditNoticeRequested',
        payload: serviceLineEditNoticeRequested.parse(payload),
      }),
  };
}
type SnapshotRow = Record<string, unknown> & {
  editor_name_ar: string | null;
  editor_name_en: string | null;
  editor_role: string | null;
  editor_role_is_system: boolean | null;
  editor_role_name_ar: string | null;
  editor_role_name_en: string | null;
  previous_net: string;
  new_net: string;
};
type ContextRow = Record<string, unknown> & {
  name_ar: string | null;
  name_en: string;
  business_timezone: string;
};
function toSnapshot(row: SnapshotRow): PriceEditSnapshot {
  return {
    editorNameAr: row.editor_name_ar,
    editorNameEn: row.editor_name_en,
    editorRole: row.editor_role,
    editorRoleIsSystem: row.editor_role_is_system,
    editorRoleNameAr: row.editor_role_name_ar,
    editorRoleNameEn: row.editor_role_name_en,
    previousNet: row.previous_net,
    newNet: row.new_net,
  };
}
function toContext(row: ContextRow): PriceEditLineContext {
  return { nameAr: row.name_ar, nameEn: row.name_en, businessTimezone: row.business_timezone };
}
