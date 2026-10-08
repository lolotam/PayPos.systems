import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  attendanceExceptionAudit,
  AttendanceExceptionError,
  type AttendanceExceptionChange,
  type AttendanceExceptionRecord,
} from '../domain/attendance-exception.ts';

export async function saveAttendanceException(
  tx: Tx,
  companyId: string,
  ids: IdGenerator,
  before: AttendanceExceptionRecord,
  change: AttendanceExceptionChange,
  action: 'resolve' | 'reopen',
) {
  const row = change.record;
  const updated = await tx.execute(sql`
    UPDATE attendance_exceptions
    SET status=${row.status}, resolution=${row.resolution}, resolved_by=${row.resolved_by},
      resolved_at=${row.resolved_at}, reason=${row.reason}, revision=${row.revision}
    WHERE company_id=${companyId} AND id=${row.id} AND revision=${before.revision} AND status=${before.status}
    RETURNING id`);
  if (updated.length !== 1)
    throw new AttendanceExceptionError('ATTENDANCE_EXCEPTION_REVISION_CONFLICT');
  const audit = attendanceExceptionAudit(before, row, change.decisionReason);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_exception',
    entityId: row.id,
    action: action === 'resolve' ? 'attendance_exception.resolved' : 'attendance_exception.reopened',
    before: audit.before,
    after: audit.after,
  });
}
