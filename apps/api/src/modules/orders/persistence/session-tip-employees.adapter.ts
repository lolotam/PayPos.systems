import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { SessionTipsReadPort } from '../ports/line-cancel.port.ts';

interface TipScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

export function sessionTipEmployees(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
): SessionTipsReadPort {
  return { currentEmployeeIds: (sessionId) => currentTipEmployeeIds(tx, { companyId, businessId, branchId }, sessionId) };
}

async function currentTipEmployeeIds(tx: Tx, scope: TipScope, sessionId: string): Promise<readonly string[]> {
  const rows = await tx.execute<{ employee_id: string }>(sql`SELECT DISTINCT t.employee_id
    FROM session_tips t
    JOIN session_tip_revisions r ON r.company_id=t.company_id AND r.business_id=t.business_id
      AND r.session_id=t.session_id AND r.id=t.revision_id
    JOIN service_sessions s ON s.company_id=r.company_id AND s.business_id=r.business_id AND s.id=r.session_id
    WHERE r.company_id=${scope.companyId} AND r.session_id=${sessionId}
      AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
      AND r.revision = (SELECT max(r2.revision) FROM session_tip_revisions r2
        WHERE r2.company_id=r.company_id AND r2.session_id=r.session_id)
    ORDER BY t.employee_id`);
  return rows.map((row) => row.employee_id);
}
