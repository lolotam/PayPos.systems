import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ActiveLinePerformers } from '../ports/line-cancel.port.ts';

interface LineScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

type ActiveRow = { line_id: string; employee_id: string | null };

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
