import type { Tx } from '@pospay/db';
import { moneyToString } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type { ServiceLineCancellationInsert } from '../ports/line-cancel.port.ts';
import { lineInScope, requireScopedInsert, type LineScope } from './line-scope.ts';

export async function markLineCancelled(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
  expectedRevision: number,
): Promise<{ changed: false } | { changed: true; revision: number }> {
  // التريغر يسمح فقط بانتقال ACTIVE إلى CANCELLED مع رفع النسخة، فالمال وباقي الأعمدة لا تُكتب.
  const rows = await tx.execute<{ revision: number }>(sql`UPDATE service_lines SET status='CANCELLED', revision=revision+1
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND session_id=${sessionId} AND id=${lineId}
      AND revision=${expectedRevision} AND status='ACTIVE'
      AND EXISTS (SELECT 1 FROM service_sessions s WHERE s.company_id=service_lines.company_id AND s.id=service_lines.session_id
        AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId})
    RETURNING revision`);
  const revision = rows[0]?.revision;
  return revision === undefined ? { changed: false } : { changed: true, revision };
}

export async function insertLineCancellation(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
  row: ServiceLineCancellationInsert,
): Promise<void> {
  const rows = await tx.execute<{ id: string }>(sql`INSERT INTO service_line_cancellations(company_id,id,business_id,line_id,revision,previous_revision,
    previous_price,previous_discount,previous_net,cancelled_by,cancelled_by_membership_id,cancelled_at,reason,
    canceller_name_ar,canceller_name_en,canceller_role,canceller_role_is_system,canceller_role_name_ar,canceller_role_name_en)
    SELECT ${scope.companyId},${row.id},${scope.businessId},${lineId},${row.revision},${row.previous_revision},
      ${moneyToString(row.previous_price)}::numeric,${moneyToString(row.previous_discount)}::numeric,${moneyToString(row.previous_net)}::numeric,
      ${row.cancelled_by},${row.cancelled_by_membership_id},${row.cancelled_at.toISOString()}::timestamptz,${row.reason},
      ${row.canceller_name_ar}::text,${row.canceller_name_en}::text,${row.canceller_role},${row.canceller_role_is_system},
      ${row.canceller_role_name_ar}::text,${row.canceller_role_name_en}
    WHERE ${lineInScope(scope, sessionId, lineId)}
    RETURNING id`);
  requireScopedInsert(rows);
}
