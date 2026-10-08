import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  AttendanceCorrectionError,
  type AttendanceCorrectionPlan,
  type AttendanceCorrectionSession,
} from '../domain/attendance-correction.ts';
import type {
  AttendanceCorrectionActor,
  AttendanceCorrectionResult,
} from '../ports/attendance-correction-transactions.port.ts';

export async function saveAttendanceCorrection(
  tx: Tx,
  actor: AttendanceCorrectionActor,
  ids: IdGenerator,
  before: AttendanceCorrectionSession,
  plan: AttendanceCorrectionPlan,
  correctedAt: Date,
): Promise<AttendanceCorrectionResult> {
  const updated = await tx.execute(sql`
    UPDATE attendance_sessions
    SET clock_in=${plan.clock_in}, clock_out=${plan.clock_out}, late_minutes=${plan.late_minutes},
      revision=${plan.revision}
    WHERE company_id=${actor.companyId} AND id=${before.id} AND revision=${before.revision}
      AND status=${before.status}
    RETURNING id`);
  if (updated.length !== 1)
    throw new AttendanceCorrectionError('ATTENDANCE_SESSION_REVISION_CONFLICT');
  const requestId = ids.newId();
  const at = correctedAt.toISOString();
  const corrections: AttendanceCorrectionResult['corrections'][number][] = [];
  for (const change of plan.corrections) {
    const id = ids.newId();
    await tx.execute(sql`
      INSERT INTO attendance_corrections(
        company_id, id, business_id, branch_id, employee_id, session_id, request_id,
        field, before_at, after_at, reason, corrected_by, corrected_at)
      VALUES(${actor.companyId},${id},${actor.businessId},${before.branch_id},${before.employee_id},
        ${before.id},${requestId},${change.field},${change.before},${change.after},${change.reason},
        ${actor.userId},${at})`);
    corrections.push({
      id,
      field: change.field,
      before: change.before,
      after: change.after,
      reason: change.reason,
      corrected_by: actor.userId,
      corrected_at: at,
    });
  }
  await appendAuditLog(tx, requestId, {
    entity: 'attendance_session',
    entityId: before.id,
    action: 'attendance_session.corrected',
    before: sessionSnapshot(before),
    after: {
      reason: plan.corrections[0]?.reason,
      corrected_at: at,
      clock_in: plan.clock_in,
      clock_out: plan.clock_out,
      late_minutes: plan.late_minutes,
      status: plan.status,
      closed_by: plan.closed_by,
      revision: plan.revision,
    },
  });
  return { session: sessionResult(before, plan), corrections };
}

function sessionSnapshot(before: AttendanceCorrectionSession) {
  return {
    clock_in: new Date(before.clock_in).toISOString(),
    clock_out: before.clock_out === null ? null : new Date(before.clock_out).toISOString(),
    late_minutes: before.late_minutes,
    status: before.status,
    closed_by: before.closed_by,
    revision: before.revision,
  };
}

function sessionResult(before: AttendanceCorrectionSession, plan: AttendanceCorrectionPlan) {
  return {
    id: before.id,
    employee_id: before.employee_id,
    branch_id: before.branch_id,
    working_date: plan.working_date,
    clock_in: plan.clock_in,
    clock_out: plan.clock_out,
    status: plan.status,
    closed_by: plan.closed_by,
    late_minutes: plan.late_minutes,
    revision: plan.revision,
  };
}
