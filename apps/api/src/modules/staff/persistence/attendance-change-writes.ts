import { appendAuditLog, appendOutboxEvents, type IdGenerator, type Tx } from '@pospay/db';
import type { AttendanceChangeRequest } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { sql } from 'drizzle-orm';
import {
  AttendanceChangeError,
  attendanceChangeRecipientGroups,
  attendanceChangeRecipients,
  attendanceChangeNoticeText,
  type AttendanceChangePlan,
} from '../domain/attendance-change-request.ts';
import type {
  AttendanceChangeKindInput,
  AttendanceChangeKindValues,
  AttendanceChangeTarget,
} from '../ports/attendance-change-kinds.port.ts';
import type { AttendanceChangeActor } from '../ports/attendance-change-transactions.port.ts';
import {
  attendanceChangeApprovers,
  attendanceChangeAuthority,
} from './attendance-change-context.adapter.ts';

interface SaveContext {
  requestId: string;
  before: AttendanceChangeRequest | null;
  target: AttendanceChangeTarget;
  input: AttendanceChangeKindInput;
  employee: { id: string; name_ar: string | null; name_en: string };
  now: Date;
  owner: boolean;
  employeeUserId: string | null;
}
export async function saveAttendanceChange(
  tx: Tx,
  ids: IdGenerator,
  actor: AttendanceChangeActor,
  context: SaveContext,
  plan: AttendanceChangePlan,
  values: AttendanceChangeKindValues,
): Promise<AttendanceChangeRequest> {
  values = targetValues(context, values);
  const id = context.before?.id ?? context.requestId;
  if (context.before) await update(tx, actor, context.before, plan, values);
  else if (plan.status === 'PENDING') await insert(tx, actor, id, context, plan, values);
  else throw new Error('ATTENDANCE_CHANGE_NOT_HELD');
  const row = record(actor, context, id, plan, values);
  if (!context.before) await audit(tx, ids, id, 'requested', null, plan);
  if (plan.status !== 'PENDING')
    await audit(tx, ids, id, plan.status.toLowerCase(), context.before, plan);
  if (plan.status !== 'CANCELLED') await events(tx, ids, actor, context, row);
  return row;
}
// خطوة المالك الواحدة تحفظ الطلب PENDING قبل أثر النوع، حتى يشير الأثر لصف موجود ويبقى السجل نفس شكل الطلب العادي.
export async function holdAttendanceChange(
  tx: Tx,
  ids: IdGenerator,
  actor: AttendanceChangeActor,
  context: SaveContext,
  plan: AttendanceChangePlan,
  values: AttendanceChangeKindValues,
): Promise<AttendanceChangePlan> {
  if (context.before) throw new Error('ATTENDANCE_CHANGE_ALREADY_HELD');
  const pending = pendingSnapshot(plan);
  values = targetValues(context, values);
  await insert(tx, actor, context.requestId, context, pending, values);
  await audit(tx, ids, context.requestId, 'requested', null, pending);
  context.before = record(actor, context, context.requestId, pending, values);
  return pending;
}
function targetValues(context: SaveContext, values: AttendanceChangeKindValues) {
  return {
    ...values,
    session_id: values.session_id ?? context.before?.session_id ?? context.input.session_id ?? null,
  };
}
function record(
  actor: AttendanceChangeActor,
  context: SaveContext,
  id: string,
  plan: AttendanceChangePlan,
  values: AttendanceChangeKindValues,
): AttendanceChangeRequest {
  return {
    ...plan,
    requested: context.before ? context.before.requested : (values.manual ?? null),
    session_id: values.session_id,
    session_revision: context.before ? context.before.session_revision : values.session_revision,
    id,
    business_id: actor.businessId,
    branch_id: context.target.branch_id,
    kind: context.input.kind,
    employee: {
      id: context.employee.id,
      name_ar: context.employee.name_ar,
      name_en: context.employee.name_en,
    },
    can_decide: context.owner && plan.status === 'PENDING',
    can_cancel: plan.status === 'PENDING' && plan.requested_by === actor.userId,
  };
}
async function insert(
  tx: Tx,
  actor: AttendanceChangeActor,
  id: string,
  context: SaveContext,
  p: AttendanceChangePlan,
  v: AttendanceChangeKindValues,
) {
  await tx.execute(sql`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,status,
    session_id,session_revision,reason,requested_by,requested_at,decided_by,decided_at,decision_reason,cancelled_by,cancelled_at,revision,clock_in,clock_out,working_date,timezone)
    VALUES(${actor.companyId},${id},${actor.businessId},${context.target.branch_id},${context.target.employee_id},${context.input.kind},${p.status},
      ${v.session_id},${v.session_revision},${p.reason},${p.requested_by},${p.requested_at},${p.decided_by},${p.decided_at},${p.decision_reason},${p.cancelled_by},${p.cancelled_at},${p.revision},${v.manual?.clock_in ?? null},${v.manual?.clock_out ?? null},${v.manual?.working_date ?? null},${v.manual?.timezone ?? null})`);
}
async function update(
  tx: Tx,
  actor: AttendanceChangeActor,
  before: AttendanceChangeRequest,
  p: AttendanceChangePlan,
  v: AttendanceChangeKindValues,
) {
  const rows =
    await tx.execute(sql`UPDATE attendance_change_requests SET status=${p.status},revision=${p.revision},
    decided_by=${p.decided_by},decided_at=${p.decided_at},decision_reason=${p.decision_reason},
    cancelled_by=${p.cancelled_by},cancelled_at=${p.cancelled_at},session_id=${v.session_id}
    WHERE company_id=${actor.companyId} AND id=${before.id} AND revision=${before.revision} AND status='PENDING' RETURNING id`);
  if (rows.length !== 1) throw new AttendanceChangeError('ATTENDANCE_CHANGE_REVISION_CONFLICT');
}
function pendingSnapshot(p: AttendanceChangePlan): AttendanceChangePlan {
  if (p.status === 'PENDING') return p;
  return {
    ...p,
    status: 'PENDING',
    revision: 0,
    decided_by: null,
    decided_at: null,
    decision_reason: null,
  };
}
function snapshot(p: AttendanceChangePlan) {
  return {
    status: p.status,
    revision: p.revision,
    requested_by: p.requested_by,
    requested_at: p.requested_at,
    decided_by: p.decided_by,
    decided_at: p.decided_at,
    cancelled_by: p.cancelled_by,
    cancelled_at: p.cancelled_at,
  };
}
async function audit(
  tx: Tx,
  ids: IdGenerator,
  id: string,
  action: string,
  before: AttendanceChangePlan | null,
  after: AttendanceChangePlan,
) {
  await appendAuditLog(tx, ids.newId(), {
    entity: 'attendance_change_request',
    entityId: id,
    action: `attendance_change.${action}`,
    ...(before ? { before: snapshot(before) } : {}),
    after: snapshot(after),
  });
}
async function eventRecipients(
  tx: Tx,
  actor: AttendanceChangeActor,
  context: SaveContext,
  row: AttendanceChangeRequest,
) {
  if (row.status === 'PENDING')
    return attendanceChangeRecipients(
      await attendanceChangeApprovers(
        tx,
        actor.companyId,
        row.business_id,
        row.branch_id,
        context.now,
      ),
      actor.userId,
      context.employeeUserId,
    );
  if (row.requested_by === actor.userId) return [];
  const requester = await attendanceChangeAuthority(
    tx,
    actor.companyId,
    row.requested_by,
    row.business_id,
    row.branch_id,
    context.now,
  );
  return requester.member ? [row.requested_by] : [];
}
async function events(
  tx: Tx,
  ids: IdGenerator,
  actor: AttendanceChangeActor,
  context: SaveContext,
  row: AttendanceChangeRequest,
) {
  const pending = row.status === 'PENDING';
  const users = await eventRecipients(tx, actor, context, row);
  const groups = attendanceChangeRecipientGroups(users);
  const facts = {
    request_id: row.id,
    kind: row.kind,
    business_id: row.business_id,
    branch_id: row.branch_id,
    employee_id: row.employee.id,
    ...snapshot(row),
  };
  const event = {
    aggregateType: 'attendance_change_request',
    aggregateId: row.id,
    eventType: pending ? 'AttendanceChangeRequested' : 'AttendanceChangeDecided',
  };
  const parameters = noticeParameters(row);
  await appendOutboxEvents(
    tx,
    (groups.length ? groups : [[]]).map((group) => ({
      id: ids.newId(),
      event: {
        ...event,
        payload: {
          ...facts,
          ...(group.length
            ? {
                notification_recipients: group.map((user_id) => ({
                  channel: 'IN_APP',
                  user_id,
                  locale: 'ar',
                  template_revision: 1,
                  template_key: pending
                    ? 'attendance_change_requested'
                    : 'attendance_change_decided',
                  safe_parameters: parameters,
                })),
              }
            : {}),
        },
      },
    })),
  );
}
function noticeParameters(row: AttendanceChangeRequest) {
  const safe = attendanceChangeNoticeText(
    row.employee,
    { ar: t('ar', 'inApp.generic_employee'), en: t('en', 'inApp.generic_employee') },
    row.decision_reason,
  );
  const parameter = (name: string, value: string) => ({ name, type: 'text', value });
  return [
    parameter('employee_name_ar', safe.employee_name_ar),
    parameter('employee_name_en', safe.employee_name_en),
    parameter('change', row.kind),
    ...(row.status === 'PENDING'
      ? []
      : [parameter('decision', row.status), parameter('reason', safe.reason)]),
  ];
}
