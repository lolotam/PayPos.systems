import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ActiveLinePerformers } from '../ports/line-cancel.port.ts';
import type { LockedLinePerformer } from '../ports/line-edit.port.ts';

interface LineScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

type RetainedRow = {
  employee_id: string;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
};

type ActiveRow = { line_id: string; employee_id: string | null };

export async function retainedLinePerformers(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
): Promise<readonly LockedLinePerformer[]> {
  // صفوف BEFORE التي لم تعد على السطر هي هويات 37b المحتفظة؛ من أُعيدت إلى السطر يغطيها الصف الحالي.
  const rows = await tx.execute<RetainedRow>(sql`SELECT r.employee_id,r.linked_user_id,r.linked_user_snapshotted
    FROM service_line_performer_change_rows r
    JOIN service_line_performer_changes c ON c.company_id=r.company_id AND c.business_id=r.business_id AND c.id=r.change_id
    JOIN service_lines l ON l.company_id=c.company_id AND l.business_id=c.business_id AND l.id=c.line_id
    JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE r.company_id=${scope.companyId} AND r.business_id=${scope.businessId} AND c.line_id=${lineId}
      AND r.side='BEFORE' AND l.session_id=${sessionId}
      AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
      AND NOT EXISTS (SELECT 1 FROM line_performers p
        WHERE p.company_id=r.company_id AND p.business_id=r.business_id AND p.line_id=c.line_id AND p.employee_id=r.employee_id)
    ORDER BY c.revision, r.performer_ordinal`);
  return rows.map((row): LockedLinePerformer => ({
    employee_id: row.employee_id,
    linked_user_id: row.linked_user_id,
    linked_user_snapshotted: row.linked_user_snapshotted,
  }));
}

export async function activeLinePerformers(tx: Tx, scope: LineScope, sessionId: string): Promise<ActiveLinePerformers> {
  const rows = await tx.execute<ActiveRow>(sql`SELECT l.id AS line_id, p.employee_id
    FROM service_lines l
    LEFT JOIN line_performers p ON p.company_id=l.company_id AND p.business_id=l.business_id AND p.line_id=l.id
    JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE l.company_id=${scope.companyId} AND l.business_id=${scope.businessId} AND l.session_id=${sessionId}
      AND l.status='ACTIVE' AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    ORDER BY l.ordinal, p.performer_ordinal`);
  return groupActiveLines(rows);
}

function groupActiveLines(rows: readonly ActiveRow[]): ActiveLinePerformers {
  const lines: { id: string }[] = [];
  const performers = new Map<string, string[]>();
  for (const row of rows) {
    const employees = performers.get(row.line_id);
    if (employees === undefined) {
      performers.set(row.line_id, row.employee_id === null ? [] : [row.employee_id]);
      lines.push({ id: row.line_id });
      continue;
    }
    if (row.employee_id !== null) employees.push(row.employee_id);
  }
  return { lines, performers_by_line: performers };
}
