import { sql } from 'drizzle-orm';
import { SessionError } from '../domain/session-error.ts';

export interface LineScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

export function lineInScope(scope: LineScope, sessionId: string, lineId: string) {
  return sql`EXISTS (SELECT 1 FROM service_lines l JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE l.company_id=${scope.companyId} AND l.business_id=${scope.businessId} AND l.session_id=${sessionId} AND l.id=${lineId}
      AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId})`;
}

export function requireScopedInsert(rows: readonly unknown[]): void {
  if (rows[0] === undefined) throw new SessionError('FORBIDDEN');
}
