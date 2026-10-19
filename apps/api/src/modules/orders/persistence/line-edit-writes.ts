import type { Tx } from '@pospay/db';
import { moneyToString } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type { LinePriceUpdate, ServiceLineEditInsert } from '../ports/line-edit.port.ts';
import { lineInScope, requireScopedInsert, type LineScope } from './line-scope.ts';

export async function updateLinePrice(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
  update: LinePriceUpdate,
): Promise<{ changed: false } | { changed: true; revision: number }> {
  const rows = await tx.execute<{ revision: number }>(sql`UPDATE service_lines SET price=${moneyToString(update.price)}::numeric,
    discount=${moneyToString(update.discount)}::numeric,net=${moneyToString(update.net)}::numeric,
    effective_discount_bps=${update.effective_discount_bps},limit_bps_applied=${update.limit_bps_applied}::int,
    limit_source=${update.limit_source},revision=revision+1
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND session_id=${sessionId} AND id=${lineId}
      AND revision=${update.expected_revision}
      AND EXISTS (SELECT 1 FROM service_sessions s WHERE s.company_id=service_lines.company_id AND s.id=service_lines.session_id
        AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId})
    RETURNING revision`);
  const revision = rows[0]?.revision;
  return revision === undefined ? { changed: false } : { changed: true, revision };
}

export async function insertLineEdit(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
  edit: ServiceLineEditInsert,
): Promise<void> {
  const rows = await tx.execute<{ id: string }>(sql`INSERT INTO service_line_edits(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,new_price,new_discount,new_net,
    previous_effective_discount_bps,previous_limit_bps_applied,previous_limit_source,
    new_effective_discount_bps,new_limit_bps_applied,new_limit_source,reason,changed_at,changed_by,changed_by_membership_id,
    editor_name_ar,editor_name_en,editor_role,editor_role_is_system,editor_role_name_ar,editor_role_name_en)
    SELECT ${scope.companyId},${edit.id},${scope.businessId},${lineId},${edit.revision},${edit.previous_revision},
      ${moneyToString(edit.previous_price)}::numeric,${moneyToString(edit.previous_discount)}::numeric,${moneyToString(edit.previous_net)}::numeric,
      ${moneyToString(edit.new_price)}::numeric,${moneyToString(edit.new_discount)}::numeric,${moneyToString(edit.new_net)}::numeric,
      ${edit.previous_effective_discount_bps},${edit.previous_limit_bps_applied}::int,${edit.previous_limit_source},
      ${edit.new_effective_discount_bps},${edit.new_limit_bps_applied}::int,${edit.new_limit_source},${edit.reason},
      ${edit.changed_at.toISOString()}::timestamptz,${edit.changed_by},${edit.changed_by_membership_id},
      ${edit.editor_name_ar}::text,${edit.editor_name_en}::text,${edit.editor_role},${edit.editor_role_is_system},
      ${edit.editor_role_name_ar}::text,${edit.editor_role_name_en}
    WHERE ${lineInScope(scope, sessionId, lineId)}
    RETURNING id`);
  requireScopedInsert(rows);
}
