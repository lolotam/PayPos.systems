import type { Tx } from '@pospay/db';
import { moneyToString, parseMoney } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import { SessionError } from '../domain/session-error.ts';
import type { TipPerformerRow } from '../domain/tip-people-links.ts';
import type { TipRevisionSession } from '../domain/tip-records.ts';
import type { TipEntry } from '../domain/tip-set.ts';
import type {
  SessionTipRevisionInsert,
  SessionTipsCurrent,
  SessionTipsRepository,
} from '../ports/session-tips.port.ts';

interface TipScope {
  companyId: string;
  businessId: string;
  branchId: string;
}

type SessionRow = {
  id: string;
  business_id: string;
  branch_id: string;
  occurred_at: Date | string;
  business_date: string;
  business_timezone: string;
};

type PeopleRow = {
  employee_id: string;
  has_active_line: boolean;
  linked_user_id: string | null;
  linked_user_snapshotted: boolean;
};

type CurrentRow = { id: string; revision: number };
type EntryRow = { employee_id: string; method: string; amount: string };

export function sessionTipsRepository(tx: Tx, scope: TipScope): SessionTipsRepository {
  return {
    lockVisit: (sessionId) => lockTipVisit(tx, sessionId),
    loadSession: (sessionId) => loadTipSession(tx, scope, sessionId),
    loadPeople: (sessionId) => loadTipPeople(tx, scope, sessionId),
    loadCurrent: (sessionId) => loadTipCurrent(tx, scope, sessionId),
    insertRevision: (sessionId, row) => insertTipRevision(tx, scope, sessionId, row),
  };
}

async function lockTipVisit(tx: Tx, sessionId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(app_company_id()::text || ':service_session:' || ${sessionId}::uuid::text,0))`,
  );
}

async function loadTipSession(
  tx: Tx,
  scope: TipScope,
  sessionId: string,
): Promise<TipRevisionSession | null> {
  const [row] =
    await tx.execute<SessionRow>(sql`SELECT id,business_id,branch_id,occurred_at,to_char(business_date,'YYYY-MM-DD') AS business_date,business_timezone
    FROM service_sessions
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND branch_id=${scope.branchId} AND id=${sessionId}`);
  if (row === undefined) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    branch_id: row.branch_id,
    occurred_at: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    business_date: row.business_date,
    business_timezone: row.business_timezone,
  };
}

async function loadTipPeople(
  tx: Tx,
  scope: TipScope,
  sessionId: string,
): Promise<readonly TipPerformerRow[]> {
  // FOR SHARE على line_performers يطلب UPDATE، ودور التطبيق SELECT/INSERT/DELETE فقط؛ قفل الموظفات يتم عبر performers.lock.
  const rows =
    await tx.execute<PeopleRow>(sql`SELECT p.employee_id,(l.status='ACTIVE') AS has_active_line,p.linked_user_id,p.linked_user_snapshotted
    FROM line_performers p
    JOIN service_lines l ON l.company_id=p.company_id AND l.business_id=p.business_id AND l.id=p.line_id
    JOIN service_sessions s ON s.company_id=l.company_id AND s.business_id=l.business_id AND s.id=l.session_id
    WHERE p.company_id=${scope.companyId} AND l.session_id=${sessionId} AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    ORDER BY l.ordinal,p.performer_ordinal`);
  return rows.map((row) => ({
    employee_id: row.employee_id,
    has_active_line: row.has_active_line === true,
    identities: [
      {
        linked_user_id: row.linked_user_id,
        linked_user_snapshotted: row.linked_user_snapshotted === true,
      },
    ],
  }));
}

async function loadTipCurrent(
  tx: Tx,
  scope: TipScope,
  sessionId: string,
): Promise<SessionTipsCurrent> {
  const [row] = await tx.execute<CurrentRow>(sql`SELECT r.id,r.revision
    FROM session_tip_revisions r
    JOIN service_sessions s ON s.company_id=r.company_id AND s.business_id=r.business_id AND s.id=r.session_id
    WHERE r.company_id=${scope.companyId} AND r.session_id=${sessionId} AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId}
    ORDER BY r.revision DESC LIMIT 1`);
  if (row === undefined) return { revision: 0, entries: [] };
  const entries = await tx.execute<EntryRow>(sql`SELECT employee_id,method,amount::text AS amount
    FROM session_tips WHERE company_id=${scope.companyId} AND revision_id=${row.id} AND session_id=${sessionId}
    ORDER BY employee_id,method`);
  return { revision: row.revision, entries: entries.map(tipEntry) };
}

async function insertTipRevision(
  tx: Tx,
  scope: TipScope,
  sessionId: string,
  row: SessionTipRevisionInsert,
): Promise<void> {
  const inserted = await tx.execute<{
    id: string;
  }>(sql`INSERT INTO session_tip_revisions(company_id,id,business_id,session_id,revision,previous_revision,
      changed_by,changed_by_membership_id,changed_at,reason,event_id,write_xid)
    SELECT ${scope.companyId},${row.id},${scope.businessId},${sessionId},${row.revision},${row.previous_revision},
      ${row.changed_by},${row.changed_by_membership_id},${row.changed_at.toISOString()}::timestamptz,${row.reason},${row.event_id},'0'::xid8
    WHERE EXISTS (SELECT 1 FROM service_sessions s
      WHERE s.company_id=${scope.companyId} AND s.business_id=${scope.businessId} AND s.branch_id=${scope.branchId} AND s.id=${sessionId})
    RETURNING id`);
  if (inserted.length !== 1) throw new SessionError('SESSION_NOT_FOUND');
  await insertTipEntries(tx, scope, sessionId, row.id, row.entries);
}

async function insertTipEntries(
  tx: Tx,
  scope: TipScope,
  sessionId: string,
  revisionId: string,
  entries: SessionTipRevisionInsert['entries'],
): Promise<void> {
  if (entries.length === 0) return;
  const values = entries.map(
    (entry) =>
      sql`(${scope.companyId},${entry.id},${scope.businessId},${revisionId},${sessionId},${entry.employee_id},${entry.method},${moneyToString(entry.amount)}::numeric)`,
  );
  await tx.execute(
    sql`INSERT INTO session_tips(company_id,id,business_id,revision_id,session_id,employee_id,method,amount) VALUES ${sql.join(values, sql`,`)}`,
  );
}

function tipEntry(row: EntryRow): TipEntry {
  if (row.method !== 'CASH' && row.method !== 'CARD') throw new Error('SESSION_PERSISTENCE_FAILED');
  return { employee_id: row.employee_id, method: row.method, amount: parseMoney(row.amount) };
}
