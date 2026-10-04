import { appendAuditLog, appendOutboxEvent, type Tx, type IdGenerator } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { PasskeyScope } from '../ports/passkeys.port.ts';
import type {
  AttendanceScan,
  AttendanceContext,
  AttendanceWrite,
} from '../ports/clock-attendance.port.ts';
import { recordAttendanceDeviceSignal } from './attendance-device-signal.ts';

export async function persistAttendance(
  tx: Tx,
  scope: PasskeyScope,
  scan: AttendanceScan,
  context: AttendanceContext,
  write: AttendanceWrite,
  ids: IdGenerator,
) {
  let accepted: string | null = null;
  if (write.open !== null && write.closeAt !== null) {
    await closeSession(tx, scope, scan, context, write);
    const missed = write.result.missed_session_id !== null;
    const closed = await recordMovement(tx, scope, ids, {
      sessionId: write.open.id,
      branchId: write.open.branchId,
      eventType: missed ? 'AttendanceMissedOut' : 'AttendanceClockedOut',
      at: write.closeAt,
      recordedAt: write.at,
    });
    if (!missed) accepted = closed;
  }
  if (write.result.operation === 'CLOCK_IN') {
    await openSession(tx, scope, scan, context, write);
    accepted = await recordMovement(tx, scope, ids, {
      sessionId: write.result.session_id,
      branchId: scan.token.branch_id,
      eventType: 'AttendanceClockedIn',
      at: write.at,
      recordedAt: write.at,
    });
  }
  if (accepted === null) throw new Error('ATTENDANCE_MOVEMENT_MISSING');
  if (write.geo !== 'OK')
    await tx.execute(sql`
    INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
    VALUES(${scope.companyId},${ids.newId()},${scope.businessId},${scope.employeeId},${scan.token.branch_id},${write.result.session_id},${write.geo},${write.at.toISOString()})`);
  await tx.execute(sql`UPDATE attendance_states SET last_accepted_scan_at=${write.at.toISOString()},last_result=${JSON.stringify(write.result)}::jsonb
    WHERE company_id=${scope.companyId} AND employee_id=${scope.employeeId}`);
  // MISSED_OUT إغلاق نظامي لا مسح؛ الإشارة تربط بصف audit لحركة المسح نفسها، وهو يبقى دائماً ويسمي الجلسة.
  await recordAttendanceDeviceSignal(tx, {
    companyId: scope.companyId,
    id: ids.newId(),
    businessId: scope.businessId,
    branchId: scan.token.branch_id,
    employeeId: scope.employeeId,
    clockEventId: accepted,
    clockedAt: write.at,
    installationId: write.installationId,
  });
}
async function openSession(
  tx: Tx,
  scope: PasskeyScope,
  scan: AttendanceScan,
  context: AttendanceContext,
  write: AttendanceWrite,
) {
  await tx.execute(sql`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,binding_id,binding_revision,qr_window,geo,latitude,longitude,accuracy,late_minutes,scheduled_start,scheduled_end)
    VALUES(${scope.companyId},${write.result.session_id},${scope.businessId},${scan.token.branch_id},${scope.employeeId},${write.result.working_date},${context.timezone},${write.at.toISOString()},'OPEN','QR',
      ${context.bindingId},${context.bindingRevision},${scan.token.window},${write.geo},${scan.location?.lat ?? null},${scan.location?.lng ?? null},${scan.location?.accuracy ?? null},${write.result.late_minutes},${write.schedule?.startsAt.toISOString() ?? null},${write.schedule?.endsAt.toISOString() ?? null})`);
}
async function closeSession(
  tx: Tx,
  scope: PasskeyScope,
  scan: AttendanceScan,
  context: AttendanceContext,
  write: AttendanceWrite,
) {
  const missed = write.result.missed_session_id !== null;
  await tx.execute(sql`UPDATE attendance_sessions SET clock_out=${write.closeAt?.toISOString() ?? null},status=${missed ? 'MISSED_OUT' : 'CLOSED'},closed_by=${missed ? 'MISSED_OUT' : 'EMPLOYEE'},
    out_binding_id=${missed ? null : context.bindingId},out_binding_revision=${missed ? null : context.bindingRevision},out_qr_window=${missed ? null : scan.token.window},out_geo=${missed ? null : write.geo},
    out_latitude=${missed ? null : (scan.location?.lat ?? null)},out_longitude=${missed ? null : (scan.location?.lng ?? null)},out_accuracy=${missed ? null : (scan.location?.accuracy ?? null)}
    WHERE company_id=${scope.companyId} AND id=${write.open?.id ?? null} AND status='OPEN'`);
  await tx.execute(sql`UPDATE attendance_exceptions SET status='RESOLVED',resolution=${missed ? 'MISSED_OUT' : 'CLOSED_LATE'},resolved_at=${write.at.toISOString()},resolved_by=${scope.userId}
    WHERE company_id=${scope.companyId} AND session_id=${write.open?.id ?? null} AND kind='SUSPECTED_MISSED_OUT' AND status='OPEN'`);
}
async function recordMovement(
  tx: Tx,
  scope: PasskeyScope,
  ids: IdGenerator,
  movement: {
    sessionId: string;
    branchId: string;
    eventType: 'AttendanceClockedIn' | 'AttendanceClockedOut' | 'AttendanceMissedOut';
    at: Date;
    recordedAt: Date;
  },
): Promise<string> {
  const payload = {
    session_id: movement.sessionId,
    employee_id: scope.employeeId,
    business_id: scope.businessId,
    branch_id: movement.branchId,
    occurred_at: movement.at.toISOString(),
    recorded_at: movement.recordedAt.toISOString(),
  };
  const auditId = ids.newId();
  await appendAuditLog(tx, auditId, {
    entity: 'attendance_session',
    entityId: movement.sessionId,
    action:
      movement.eventType === 'AttendanceClockedIn'
        ? 'clocked_in'
        : movement.eventType === 'AttendanceClockedOut'
          ? 'clocked_out'
          : 'missed_out',
    after: payload,
  });
  await appendOutboxEvent(tx, ids.newId(), {
    aggregateType: 'employee',
    aggregateId: scope.employeeId,
    eventType: movement.eventType,
    payload,
  });
  return auditId;
}
