import { sql } from 'drizzle-orm';

export const uuidArray = (ids: string[]) =>
  sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
export function leaveListRecord(
  context: { userId: string; own: boolean },
  scope: {
    cancelBranches: string[];
    decideBranches?: string[];
    revokeBranches?: string[];
    now?: Date;
  },
) {
  // قائمة الطلبات والسجل يعرضان نفس القرار والأفعال من ساعة الصلاحيات الحالية.
  return sql`jsonb_build_object('id',l.id,'business_id',l.business_id,'branch_id',l.branch_id,'employee_id',l.employee_id,
    'employee_name_en',subject.name_en,'employee_name_ar',subject.name_ar,
    'kind',l.kind,'from',l."from",'to',l."to",'start',l.start,'end',l."end",'timezone',l.timezone,
    'starts_at',to_char(l.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'ends_at',to_char(l.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'type',l.type,'note',l.note,'status',l.status,'requested_by',l.requested_by,
    'requested_at',to_char(l.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'cancelled_by',l.cancelled_by,'cancelled_at',to_char(l.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'decided_by',l.decided_by,'decided_at',to_char(l.decided_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'rejection_reason',l.rejection_reason,'decision_reason',l.decision_reason,'revoked_by',l.revoked_by,
    'revoked_at',to_char(l.revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'revocation_reason',l.revocation_reason,'revision',l.revision,
    'can_cancel',l.status='PENDING' AND l.branch_id=ANY(${uuidArray(scope.cancelBranches)}) AND (${!context.own} OR l.requested_by=${context.userId}),
    'can_decide',${!context.own} AND l.status='PENDING' AND l.branch_id=ANY(${uuidArray(scope.decideBranches ?? [])}) AND subject.user_id IS DISTINCT FROM ${context.userId}::uuid,
    'can_revoke',${!context.own} AND l.status='APPROVED' AND l.starts_at>${(scope.now ?? new Date(0)).toISOString()}::timestamptz AND l.branch_id=ANY(${uuidArray(scope.revokeBranches ?? [])}) AND subject.user_id IS DISTINCT FROM ${context.userId}::uuid)`;
}
