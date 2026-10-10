import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { AttendanceChangeError } from '../domain/attendance-change-request.ts';
import type { AttendanceVoidPlan, AttendanceVoidSession } from '../domain/attendance-void.ts';
import type {
  AttendanceChangeKind,
  AttendanceChangeKindScope,
  AttendanceChangeKindValues,
} from '../ports/attendance-change-kinds.port.ts';

interface VoidSession extends AttendanceVoidSession {
  employee_id: string;
  branch_id: string;
  working_date: string;
  timezone: string;
  voided_by: string | null;
  void_request_id: string | null;
}

export const voidSessionTarget: AttendanceChangeKind['target'] = async (scope) => {
  if (!scope.input.session_id) return null;
  const [row] = await (scope.transaction as Tx).execute<{
    employee_id: string;
    branch_id: string;
  }>(sql`
    SELECT employee_id,branch_id FROM attendance_sessions
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND id=${scope.input.session_id} AND employee_id=${scope.input.employee_id}`);
  return row ?? null;
};

export async function lockVoidSession(scope: AttendanceChangeKindScope): Promise<VoidSession> {
  const [row] = await (scope.transaction as Tx).execute<VoidSession & Record<string, unknown>>(sql`
    SELECT id,employee_id,branch_id,working_date::text AS working_date,timezone,status,revision,
      to_char(clock_in AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_in,
      to_char(clock_out AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS clock_out,
      to_char(voided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS voided_at,
      voided_by,void_request_id
    FROM attendance_sessions WHERE company_id=${scope.companyId} AND business_id=${scope.businessId}
      AND id=${scope.input.session_id ?? null}::uuid AND employee_id=${scope.input.employee_id}
      AND employee_id=${scope.target.employee_id} AND branch_id=${scope.target.branch_id} FOR UPDATE`);
  if (!row) throw new AttendanceChangeError('NOT_FOUND');
  return row;
}

export async function assertNoPendingSessionChange(
  scope: AttendanceChangeKindScope,
): Promise<void> {
  const rows = await (scope.transaction as Tx).execute(sql`
    SELECT id FROM attendance_change_requests WHERE company_id=${scope.companyId}
      AND session_id=${scope.input.session_id} AND status='PENDING'
      AND kind IN ('VOID_SESSION','RESTORE_SESSION')
      ${scope.request === null ? sql`` : sql`AND id<>${scope.requestId}`} LIMIT 1`);
  if (rows.length) throw new AttendanceChangeError('ATTENDANCE_CHANGE_DUPLICATE_PENDING');
}

export function voidSessionRequest(scope: AttendanceChangeKindScope) {
  if (scope.input.session_revision === undefined)
    throw new AttendanceChangeError('VALIDATION_FAILED');
  return { session_revision: scope.input.session_revision };
}

export function voidSessionValues(session: VoidSession): AttendanceChangeKindValues {
  return {
    session_id: session.id,
    session_revision: session.revision,
    requested: {
      working_date: session.working_date,
      timezone: session.timezone,
      clock_in: session.clock_in,
      clock_out: session.clock_out,
    },
  };
}

function marks(session: AttendanceVoidPlan) {
  return {
    voided_at: session.voided_at,
    voided_by: session.voided_by,
    void_request_id: session.void_request_id,
    revision: session.revision,
  };
}

export async function writeVoidSession(
  scope: AttendanceChangeKindScope,
  ids: IdGenerator,
  session: VoidSession,
  plan: AttendanceVoidPlan,
  action: 'voided' | 'restored',
): Promise<AttendanceChangeKindValues> {
  const tx = scope.transaction as Tx;
  const rows = await tx.execute(sql`UPDATE attendance_sessions
    SET voided_at=${plan.voided_at},voided_by=${plan.voided_by},void_request_id=${plan.void_request_id},revision=${plan.revision}
    WHERE company_id=${scope.companyId} AND business_id=${scope.businessId} AND id=${session.id}
      AND revision=${session.revision} RETURNING id`);
  if (rows.length !== 1) throw new AttendanceChangeError('ATTENDANCE_SESSION_REVISION_CONFLICT');
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_session',
    entityId: session.id,
    action: `attendance_session.${action}`,
    before: marks(session),
    after: marks(plan),
  });
  return {
    ...voidSessionValues(session),
    effect: {
      session: {
        id: session.id,
        working_date: session.working_date,
        clock_in: session.clock_in,
        clock_out: session.clock_out,
        status: session.status,
        ...plan,
      },
    },
  };
}
