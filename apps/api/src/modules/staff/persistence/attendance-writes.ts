import { appendAuditLog, appendOutboxEvent, type Tx, type IdGenerator } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { PasskeyScope } from '../ports/passkeys.port.ts';
import type {
  AttendanceScan,
  AttendanceContext,
  AttendanceWrite,
} from '../ports/clock-attendance.port.ts';
import type { ClockLocation } from '../domain/clock-attendance.ts';
import { recordAttendanceDeviceSignal } from './attendance-device-signal.ts';

/** حقائق الحركة المشتركة بين مسح QR الشخصي والكارت على الجهاز، بلا منطق انتقال. */
export interface AttendanceMovementRef {
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
  readonly branchId: string;
  readonly source: 'QR' | 'BARCODE';
  readonly binding: { readonly id: string; readonly revision: number } | null;
  readonly qrWindow: number | null;
  readonly deviceId: string | null;
  readonly operatorId: string | null;
  readonly location: ClockLocation | undefined;
  readonly installationId: string | null;
  readonly timezone: string;
  readonly resolvedByUserId: string | null;
}
/** الكتابة الدنيا التي يقررها الـ use case من الدومين، مشتركة بين مصدري الدخول. */
export interface AttendanceMovementWrite {
  readonly result: AttendanceWrite['result'];
  readonly open: AttendanceWrite['open'];
  readonly closeAt: AttendanceWrite['closeAt'];
  readonly geo: AttendanceWrite['geo'];
  readonly at: AttendanceWrite['at'];
  readonly schedule: AttendanceWrite['schedule'];
}

// مسار PR 22 كما هو: يوسم حقول الربط والمسح من السياق ثم يستدعي الكاتب المشترك.
export function persistAttendance(
  tx: Tx,
  scope: PasskeyScope,
  scan: AttendanceScan,
  context: AttendanceContext,
  write: AttendanceWrite,
  ids: IdGenerator,
) {
  return persistAttendanceMovement(
    tx,
    {
      companyId: scope.companyId,
      businessId: scope.businessId,
      employeeId: scope.employeeId,
      branchId: scan.token.branch_id,
      source: 'QR',
      binding: { id: context.bindingId, revision: context.bindingRevision },
      qrWindow: scan.token.window,
      deviceId: null,
      operatorId: null,
      location: scan.location,
      installationId: write.installationId,
      timezone: context.timezone,
      resolvedByUserId: scope.userId,
    },
    write,
    ids,
  );
}

// الحركة تُكتب مرة واحدة: الجلسة والتدقيق والحدث والحالة والإشارة في نفس المعاملة.
export async function persistAttendanceMovement(
  tx: Tx,
  ref: AttendanceMovementRef,
  write: AttendanceMovementWrite,
  ids: IdGenerator,
): Promise<void> {
  let accepted: string | null = null;
  if (write.open !== null && write.closeAt !== null) {
    await closeSession(tx, ref, write);
    const missed = write.result.missed_session_id !== null;
    const closed = await recordMovement(tx, ref, ids, {
      sessionId: write.open.id,
      branchId: write.open.branchId,
      eventType: missed ? 'AttendanceMissedOut' : 'AttendanceClockedOut',
      at: write.closeAt,
      recordedAt: write.at,
    });
    if (!missed) accepted = closed;
  }
  if (write.result.operation === 'CLOCK_IN') {
    await openSession(tx, ref, write);
    accepted = await recordMovement(tx, ref, ids, {
      sessionId: write.result.session_id,
      branchId: ref.branchId,
      eventType: 'AttendanceClockedIn',
      at: write.at,
      recordedAt: write.at,
    });
  }
  if (accepted === null) throw new Error('ATTENDANCE_MOVEMENT_MISSING');
  for (const kind of write.result.exceptions)
    await tx.execute(sql`
    INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
    VALUES(${ref.companyId},${ids.newId()},${ref.businessId},${ref.employeeId},${ref.branchId},${write.result.session_id},${kind},${write.at.toISOString()})`);
  await tx.execute(sql`UPDATE attendance_states SET last_accepted_scan_at=${write.at.toISOString()},last_result=${JSON.stringify(write.result)}::jsonb
    WHERE company_id=${ref.companyId} AND employee_id=${ref.employeeId}`);
  // MISSED_OUT إغلاق نظامي لا مسح؛ الإشارة تربط بصف audit لحركة المسح نفسها، وهو يبقى دائماً ويسمي الجلسة.
  if (ref.installationId !== null)
    await recordAttendanceDeviceSignal(tx, {
      companyId: ref.companyId,
      id: ids.newId(),
      businessId: ref.businessId,
      branchId: ref.branchId,
      employeeId: ref.employeeId,
      clockEventId: accepted,
      clockedAt: write.at,
      installationId: ref.installationId,
    });
}
async function openSession(tx: Tx, ref: AttendanceMovementRef, write: AttendanceMovementWrite) {
  await tx.execute(sql`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,binding_id,binding_revision,qr_window,geo,latitude,longitude,accuracy,late_minutes,scheduled_start,scheduled_end,device_id,operator_id)
    VALUES(${ref.companyId},${write.result.session_id},${ref.businessId},${ref.branchId},${ref.employeeId},${write.result.working_date},${ref.timezone},${write.at.toISOString()},'OPEN',${ref.source},
      ${ref.binding?.id ?? null},${ref.binding?.revision ?? null},${ref.qrWindow},${write.geo},${ref.location?.lat ?? null},${ref.location?.lng ?? null},${ref.location?.accuracy ?? null},${write.result.late_minutes},${write.schedule?.startsAt.toISOString() ?? null},${write.schedule?.endsAt.toISOString() ?? null},${ref.deviceId},${ref.operatorId})`);
}
async function closeSession(tx: Tx, ref: AttendanceMovementRef, write: AttendanceMovementWrite) {
  const missed = write.result.missed_session_id !== null;
  await tx.execute(sql`UPDATE attendance_sessions SET clock_out=${write.closeAt?.toISOString() ?? null},status=${missed ? 'MISSED_OUT' : 'CLOSED'},closed_by=${missed ? 'MISSED_OUT' : 'EMPLOYEE'},
    out_binding_id=${missed ? null : (ref.binding?.id ?? null)},out_binding_revision=${missed ? null : (ref.binding?.revision ?? null)},out_qr_window=${missed ? null : ref.qrWindow},out_geo=${missed ? null : write.geo},
    out_latitude=${missed ? null : (ref.location?.lat ?? null)},out_longitude=${missed ? null : (ref.location?.lng ?? null)},out_accuracy=${missed ? null : (ref.location?.accuracy ?? null)},
    out_device_id=${missed ? null : ref.deviceId},out_operator_id=${missed ? null : ref.operatorId}
    WHERE company_id=${ref.companyId} AND id=${write.open?.id ?? null} AND status='OPEN'`);
  await tx.execute(sql`UPDATE attendance_exceptions SET status='RESOLVED',resolution=${missed ? 'MISSED_OUT' : 'CLOSED_LATE'},resolved_at=${write.at.toISOString()},resolved_by=${ref.resolvedByUserId}
    WHERE company_id=${ref.companyId} AND session_id=${write.open?.id ?? null} AND kind='SUSPECTED_MISSED_OUT' AND status='OPEN'`);
}
async function recordMovement(
  tx: Tx,
  ref: AttendanceMovementRef,
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
    employee_id: ref.employeeId,
    business_id: ref.businessId,
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
    aggregateId: ref.employeeId,
    eventType: movement.eventType,
    payload,
  });
  return auditId;
}
