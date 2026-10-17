import type { Tx } from '@pospay/db';
import { parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import type { LockedLinePerformer, LockedServiceLine } from '../ports/line-edit.port.ts';
import { loadSession } from './session-records.ts';

interface LineScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

type LineRow = {
  status: string;
  revision: number;
  list_price: string;
  price: string;
  discount: string;
  net: string;
  effective_discount_bps: number;
  limit_bps_applied: number | null;
  limit_source: LockedServiceLine['limit_source'];
  business_date: string;
  business_timezone: string;
  occurred_at: Date | string;
};

type PerformerRow = {
  employee_id: string;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
};

export async function lockLineEditVisit(tx: Tx, sessionId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(app_company_id()::text || ':service_session:' || ${sessionId}::uuid::text,0))`);
}

export async function loadLineForUpdate(
  tx: Tx,
  scope: LineScope,
  sessionId: string,
  lineId: string,
): Promise<LockedServiceLine | null> {
  const [row] = await tx.execute<LineRow>(sql`SELECT l.status,l.revision,l.list_price::text,l.price::text,l.discount::text,l.net::text,
    l.effective_discount_bps,l.limit_bps_applied,l.limit_source,to_char(s.business_date,'YYYY-MM-DD') AS business_date,
    s.business_timezone,s.occurred_at
    FROM service_lines l JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE l.company_id=${scope.companyId} AND l.business_id=${scope.businessId} AND l.session_id=${sessionId} AND l.id=${lineId}
      AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    FOR UPDATE OF l`);
  if (row === undefined) return null;
  const performers = await tx.execute<PerformerRow>(sql`SELECT employee_id,linked_user_id,linked_user_snapshotted
    FROM line_performers WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND line_id=${lineId}
    ORDER BY performer_ordinal`);
  return lockedLine(row, performers);
}

export async function activeLineNets(tx: Tx, scope: LineScope, sessionId: string, exceptLineId: string): Promise<readonly bigint[]> {
  const rows = await tx.execute<{ net: string }>(sql`SELECT l.net::text AS net FROM service_lines l
    JOIN service_sessions s ON s.company_id=l.company_id AND s.id=l.session_id
    WHERE l.company_id=${scope.companyId} AND l.business_id=${scope.businessId} AND l.session_id=${sessionId}
      AND l.id<>${exceptLineId} AND l.status='ACTIVE' AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    ORDER BY l.ordinal`);
  return rows.map((row) => parseMoney(row.net));
}

export function loadEditableSession(tx: Tx, scope: LineScope, sessionId: string) {
  return loadSession(tx, scope.companyId, scope.businessId, scope.branchId, sessionId);
}

function lockedLine(row: LineRow, performers: readonly PerformerRow[]): LockedServiceLine {
  return {
    status: lineStatus(row.status),
    revision: row.revision,
    list_price: parseMoney(row.list_price),
    price: parseMoney(row.price),
    discount: parseMoney(row.discount),
    net: parseMoney(row.net),
    effective_discount_bps: row.effective_discount_bps,
    limit_bps_applied: row.limit_bps_applied,
    limit_source: row.limit_source,
    business_date: row.business_date,
    business_timezone: row.business_timezone,
    occurred_at: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    performers: performers.map((performer): LockedLinePerformer => ({
      employee_id: performer.employee_id,
      linked_user_id: performer.linked_user_id,
      linked_user_snapshotted: performer.linked_user_snapshotted,
    })),
  };
}

function lineStatus(status: string): LockedServiceLine['status'] {
  switch (status) {
    case 'ACTIVE':
    case 'CANCELLED':
      return status;
    default:
      throw new Error('Invalid stored line status');
  }
}
