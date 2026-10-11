import { appendAuditLog, type IdGenerator, type Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { ManualSessionPlan } from '../domain/manual-attendance-session.ts';
import type { AttendanceChangeKindScope } from '../ports/attendance-change-kinds.port.ts';

export async function insertManualSession(
  scope: AttendanceChangeKindScope,
  plan: ManualSessionPlan,
  ids: IdGenerator,
) {
  const tx = scope.transaction as Tx;
  const id = ids.newId();
  await tx.execute(sql`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,
    working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes,
    scheduled_start,scheduled_end,revision,change_request_id)
    VALUES(${scope.companyId},${id},${scope.businessId},${scope.target.branch_id},${scope.target.employee_id},
      ${plan.working_date},${plan.timezone},${plan.clock_in},${plan.clock_out},'CLOSED','MANUAL','MANUAL','NONE','NONE',
      ${plan.late_minutes},${plan.scheduled_start},${plan.scheduled_end},0,${scope.requestId})`);
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_session',
    entityId: id,
    action: 'attendance_session.added_manual',
    after: {
      source: 'MANUAL',
      working_date: plan.working_date,
      clock_in: plan.clock_in,
      clock_out: plan.clock_out,
      late_minutes: plan.late_minutes,
      scheduled_start: plan.scheduled_start,
      change_request_id: scope.requestId,
      requested_by: scope.request?.requested_by ?? scope.userId,
      approved_by: scope.userId,
    },
  });
  return id;
}
