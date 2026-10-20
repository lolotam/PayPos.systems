import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { LockedLinePerformer } from '../ports/line-edit.port.ts';
import type { SessionLineIdentityPort } from '../ports/line-identity.port.ts';
import type { LineScope } from './line-scope.ts';

type RetainedRow = {
  employee_id: string;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
};

export function lineIdentity(tx: Tx, scope: LineScope): SessionLineIdentityPort {
  return {
    retainedForLine: (sessionId, lineId) => retainedLinePerformers(tx, scope, sessionId, lineId),
    retainedForSession: (sessionId) => retainedSessionPerformers(tx, scope, sessionId),
  };
}

export async function retainedLinePerformers(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
): Promise<readonly LockedLinePerformer[]> {
  // إعادة الإضافة قد تربط الموظفة بمستخدم آخر؛ لقطة BEFORE القديمة لازم تمنع إلغاءها لنفسها حتى وهي على السطر.
  const rows = await tx.execute<RetainedRow>(sql`SELECT DISTINCT ON (r.employee_id, r.linked_user_id, r.linked_user_snapshotted)
      r.employee_id, r.linked_user_id, r.linked_user_snapshotted
    FROM service_line_performer_change_rows r
    JOIN service_line_performer_changes c ON c.company_id=r.company_id AND c.business_id=r.business_id AND c.id=r.change_id
    JOIN service_lines l ON l.company_id=c.company_id AND l.business_id=c.business_id AND l.id=c.line_id
    JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE r.company_id=${scope.companyId} AND r.business_id=${scope.businessId} AND c.line_id=${lineId}
      AND r.side='BEFORE' AND l.session_id=${sessionId}
      AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    ORDER BY r.employee_id, r.linked_user_id, r.linked_user_snapshotted, c.revision, r.performer_ordinal`);
  return rows.map((row): LockedLinePerformer => ({
    employee_id: row.employee_id,
    linked_user_id: row.linked_user_id,
    linked_user_snapshotted: row.linked_user_snapshotted,
  }));
}

export async function retainedSessionPerformers(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
): Promise<readonly LockedLinePerformer[]> {
  const rows = await tx.execute<RetainedRow>(sql`SELECT DISTINCT ON (r.employee_id, r.linked_user_id, r.linked_user_snapshotted)
      r.employee_id, r.linked_user_id, r.linked_user_snapshotted
    FROM service_line_performer_change_rows r
    JOIN service_line_performer_changes c ON c.company_id=r.company_id AND c.business_id=r.business_id AND c.id=r.change_id
    JOIN service_lines l ON l.company_id=c.company_id AND l.business_id=c.business_id AND l.id=c.line_id
    JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE r.company_id=${scope.companyId} AND r.business_id=${scope.businessId}
      AND r.side='BEFORE' AND l.session_id=${sessionId}
      AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    ORDER BY r.employee_id, r.linked_user_id, r.linked_user_snapshotted, c.revision, r.performer_ordinal`);
  return rows.map((row): LockedLinePerformer => ({
    employee_id: row.employee_id,
    linked_user_id: row.linked_user_id,
    linked_user_snapshotted: row.linked_user_snapshotted,
  }));
}
