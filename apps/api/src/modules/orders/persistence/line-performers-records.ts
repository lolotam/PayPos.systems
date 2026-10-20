import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { LinePerformerRow } from '../domain/line-performers-plan.ts';
import type { LineScope } from './line-scope.ts';

type PerformerRow = {
  employee_id: string;
  performer_ordinal: number;
  share_bps: number;
  name_en: string;
  name_ar: string | null;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
  not_clocked_in_warning: boolean;
  approved_leave_warning: boolean;
};

export async function currentPerformers(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
): Promise<LinePerformerRow[]> {
  const rows = await tx.execute<PerformerRow>(sql`SELECT p.employee_id,p.performer_ordinal,p.share_bps,p.name_en,p.name_ar,
    p.linked_user_id,p.linked_user_snapshotted,p.not_clocked_in_warning,p.approved_leave_warning
    FROM line_performers p
    JOIN service_lines l ON l.company_id=p.company_id AND l.business_id=p.business_id AND l.id=p.line_id
    JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE p.company_id=${scope.companyId} AND p.business_id=${scope.businessId} AND l.session_id=${sessionId} AND p.line_id=${lineId}
      AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    ORDER BY p.performer_ordinal`);
  return rows.map((row) => ({
    employee_id: row.employee_id,
    performer_ordinal: row.performer_ordinal,
    share_bps: row.share_bps,
    name_en: row.name_en,
    name_ar: row.name_ar,
    linked_user_id: row.linked_user_id,
    linked_user_snapshotted: row.linked_user_snapshotted,
    not_clocked_in_warning: row.not_clocked_in_warning,
    approved_leave_warning: row.approved_leave_warning,
  }));
}

export async function isPriceEdited(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ edited: boolean }>(sql`SELECT EXISTS (
    SELECT 1 FROM service_line_edits e
    JOIN service_lines l ON l.company_id=e.company_id AND l.business_id=e.business_id AND l.id=e.line_id
    JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE e.company_id=${scope.companyId} AND e.business_id=${scope.businessId} AND e.line_id=${lineId}
      AND l.session_id=${sessionId} AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}) AS edited`);
  return rows[0]?.edited === true;
}
