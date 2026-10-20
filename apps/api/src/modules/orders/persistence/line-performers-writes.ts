import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ServiceLinePerformerChangeInsert, StoredPerformerRow } from '../ports/line-performers.port.ts';
import { lineInScope, requireScopedInsert, type LineScope } from './line-scope.ts';

export async function insertPerformerChange(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
  row: ServiceLinePerformerChangeInsert,
): Promise<void> {
  // الختم (write_xid وwrite_system_id) يطبله تريغر ما قبل الإدخال؛ ترك العمودين خارج الجملة هو الطريق الوحيد.
  const rows = await tx.execute<{ id: string }>(sql`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,
    reason,changed_at,changed_by,changed_by_membership_id,changer_name_ar,changer_name_en,changer_role,changer_role_is_system,changer_role_name_ar,changer_role_name_en)
    SELECT ${scope.companyId},${row.id},${scope.businessId},${lineId},${row.revision},${row.previous_revision},
      ${row.reason},${row.changed_at.toISOString()}::timestamptz,${row.changed_by},${row.changed_by_membership_id},
      ${row.changer_name_ar}::text,${row.changer_name_en}::text,${row.changer_role},${row.changer_role_is_system},
      ${row.changer_role_name_ar}::text,${row.changer_role_name_en}
    WHERE ${lineInScope(scope, sessionId, lineId)}
    RETURNING id`);
  requireScopedInsert(rows);
}

export async function insertPerformerSide(
  tx: Tx,
  scope: LineScope,
  changeId: string,
  side: 'BEFORE' | 'AFTER',
  rows: readonly StoredPerformerRow[],
): Promise<void> {
  for (const row of rows) {
    await tx.execute(sql`INSERT INTO service_line_performer_change_rows(company_id,id,business_id,change_id,side,employee_id,performer_ordinal,share_bps,
      name_en,name_ar,linked_user_id,linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning)
      VALUES(${scope.companyId},${row.id},${scope.businessId},${changeId},${side},${row.employee_id},${row.performer_ordinal},${row.share_bps},
        ${row.name_en},${row.name_ar}::text,${row.linked_user_id}::uuid,${row.linked_user_snapshotted},
        ${row.not_clocked_in_warning},${row.approved_leave_warning})`);
  }
}

export async function bumpPerformersRevision(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
  expectedRevision: number,
  hasPerformerWarning: boolean,
): Promise<{ changed: false } | { changed: true; revision: number }> {
  const rows = await tx.execute<{ revision: number }>(sql`UPDATE service_lines SET revision=revision+1, has_performer_warning=${hasPerformerWarning}
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND session_id=${sessionId} AND id=${lineId}
      AND revision=${expectedRevision} AND status='ACTIVE'
      AND EXISTS (SELECT 1 FROM service_sessions s WHERE s.company_id=service_lines.company_id AND s.id=service_lines.session_id
        AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId})
    RETURNING revision`);
  const revision = rows[0]?.revision;
  return revision === undefined ? { changed: false } : { changed: true, revision };
}

export async function replaceLinePerformers(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
  rows: readonly StoredPerformerRow[],
): Promise<void> {
  await tx.execute(sql`DELETE FROM line_performers p WHERE p.company_id=${scope.companyId} AND p.business_id=${scope.businessId} AND p.line_id=${lineId}
    AND EXISTS (SELECT 1 FROM service_lines l WHERE l.company_id=p.company_id AND l.business_id=p.business_id AND l.id=p.line_id AND l.session_id=${sessionId})`);
  for (const row of rows) {
    await tx.execute(sql`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,name_ar,
      linked_user_id,linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning)
      VALUES(${scope.companyId},${row.id},${scope.businessId},${lineId},${row.employee_id},${row.performer_ordinal},${row.share_bps},
        ${row.name_en},${row.name_ar}::text,${row.linked_user_id}::uuid,${row.linked_user_snapshotted},
        ${row.not_clocked_in_warning},${row.approved_leave_warning})`);
  }
}
