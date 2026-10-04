import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { MissedOutSession } from '../domain/missed-out.ts';
import type {
  LockedMissedOutSession,
  MissedOutCursor,
  MissedOutTransactions,
} from '../ports/missed-out.port.ts';
import { closeMissedOut, raiseSuspected } from './missed-out-writes.ts';

// أطول من مهلة معاملة المسح (١٠ ثوانٍ في PR 22) لأن الوظيفة قد تنتظر قفل State الذي يمسكه مسح جارٍ.
export const MISSED_OUT_TRANSACTION_TIMEOUT_MS = 15_000;

type SessionRow = {
  id: string;
  employee_id: string;
  clock_in: Date | string;
  scheduled_end: Date | string | null;
  suspected: boolean;
};

export function missedOutCandidatesStatement(
  companyId: string,
  clockInAtOrBefore: Date,
  after: MissedOutCursor | null,
  limit: number,
) {
  const page =
    after === null
      ? sql``
      : sql`AND (s.clock_in, s.id) > (${after.clockIn.toISOString()}::timestamptz, ${after.id}::uuid)`;
  return sql`SELECT s.id, s.employee_id, s.clock_in, s.scheduled_end,
      EXISTS (SELECT 1 FROM attendance_exceptions e WHERE e.company_id = s.company_id AND e.session_id = s.id
        AND e.kind = 'SUSPECTED_MISSED_OUT') AS suspected
    FROM attendance_sessions s
    WHERE s.company_id = ${companyId} AND s.status = 'OPEN'
      AND s.clock_in <= ${clockInAtOrBefore.toISOString()}::timestamptz ${page}
    ORDER BY s.clock_in, s.id LIMIT ${limit}`;
}

function toSession(row: SessionRow): MissedOutSession {
  return {
    id: row.id,
    employeeId: row.employee_id,
    clockIn: new Date(row.clock_in),
    scheduledEnd: row.scheduled_end === null ? null : new Date(row.scheduled_end),
    suspectedRaised: row.suspected,
  };
}

async function lockedOpenSession(
  tx: Tx,
  companyId: string,
  employeeId: string,
): Promise<LockedMissedOutSession | null> {
  const [state] = await tx.execute<{ employee_id: string }>(sql`
    SELECT employee_id FROM attendance_states WHERE company_id = ${companyId} AND employee_id = ${employeeId} FOR UPDATE`);
  if (state === undefined) return null;
  const [row] = await tx.execute<SessionRow & { business_id: string; branch_id: string }>(sql`
    SELECT s.id, s.employee_id, s.business_id, s.branch_id, s.clock_in, s.scheduled_end,
      EXISTS (SELECT 1 FROM attendance_exceptions e WHERE e.company_id = s.company_id AND e.session_id = s.id
        AND e.kind = 'SUSPECTED_MISSED_OUT') AS suspected
    FROM attendance_sessions s WHERE s.company_id = ${companyId} AND s.employee_id = ${employeeId} AND s.status = 'OPEN'`);
  return row === undefined
    ? null
    : { ...toSession(row), businessId: row.business_id, branchId: row.branch_id };
}

export function missedOutTransactions(
  database: Pick<TenantWrappers, 'withTenant'>,
  ids: IdGenerator,
): MissedOutTransactions {
  return {
    candidates: (companyId, clockInAtOrBefore, after, limit) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const rows = await tx.execute<SessionRow>(
            missedOutCandidatesStatement(companyId, clockInAtOrBefore, after, limit),
          );
          return rows.map(toSession);
        },
        { timeoutMs: MISSED_OUT_TRANSACTION_TIMEOUT_MS },
      ),
    run: (companyId, employeeId, sample, work) =>
      database.withTenant(
        companyId,
        async (tx) => {
          const open = await lockedOpenSession(tx, companyId, employeeId);
          return work(
            {
              open,
              raiseSuspected: (session, dueAt, at) =>
                raiseSuspected(tx, ids, companyId, session, dueAt, at),
              closeMissedOut: (session, closeAt, at) =>
                closeMissedOut(tx, ids, companyId, session, closeAt, at),
            },
            sample(),
          );
        },
        { timeoutMs: MISSED_OUT_TRANSACTION_TIMEOUT_MS },
      ),
  };
}
