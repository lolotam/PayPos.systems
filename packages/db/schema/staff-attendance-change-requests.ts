import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';
import { companies, branches } from './tenancy.ts';
import { employees } from './staff.ts';
import { user } from './identity-auth.ts';
import { attendanceSessions } from './staff-attendance.ts';

export const attendanceChangeRequests = pgTable(
  'attendance_change_requests',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('PENDING'),
    // جلسة الإلغاء المستهدفة أو جلسة الإضافة الناتجة بعد الموافقة.
    sessionId: uuid('session_id'),
    // نسخة جلسة الإلغاء التي شاهدها مقدم الطلب.
    sessionRevision: integer('session_revision'),
    reason: text('reason').notNull(),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => user.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    decidedBy: uuid('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    cancelledBy: uuid('cancelled_by').references(() => user.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // تزيد عند الانتقال لحالة نهائية لمنع اتخاذ قرار على نسخة قديمة.
    revision: integer('revision').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'attendance_change_requests_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'attendance_change_requests_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'attendance_change_requests_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'attendance_change_requests_session_fk',
      columns: [t.companyId, t.sessionId],
      foreignColumns: [attendanceSessions.companyId, attendanceSessions.id],
    }),
    index('attendance_change_requests_inbox_idx').on(
      t.companyId,
      t.businessId,
      t.status,
      t.requestedAt,
    ),
    index('attendance_change_requests_branch_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.status,
      t.requestedAt,
    ),
    index('attendance_change_requests_employee_idx').on(t.companyId, t.employeeId, t.requestedAt),
    index('attendance_change_requests_session_idx').on(t.companyId, t.sessionId),
    index('attendance_change_requests_requester_idx').on(t.companyId, t.requestedBy),
    index('attendance_change_requests_decider_idx').on(t.companyId, t.decidedBy),
    index('attendance_change_requests_canceller_idx').on(t.companyId, t.cancelledBy),
    uniqueIndex('attendance_change_requests_one_pending_void')
      .on(t.companyId, t.sessionId)
      .where(sql`${t.status} = 'PENDING' AND ${t.kind} = 'VOID_SESSION'`),
    ...changeChecks(t),
  ],
);

type CheckColumns = Record<
  | 'kind'
  | 'status'
  | 'revision'
  | 'sessionRevision'
  | 'reason'
  | 'decisionReason'
  | 'decidedBy'
  | 'decidedAt'
  | 'cancelledBy'
  | 'cancelledAt',
  PgColumn
>;
function changeChecks(t: CheckColumns) {
  return [
    check('attendance_change_requests_kind', sql`${t.kind} IN ('ADD_SESSION','VOID_SESSION')`),
    check(
      'attendance_change_requests_status',
      sql`${t.status} IN ('PENDING','APPROVED','REJECTED','CANCELLED')`,
    ),
    check('attendance_change_requests_revision', sql`${t.revision} >= 0`),
    check(
      'attendance_change_requests_session_revision',
      sql`${t.sessionRevision} IS NULL OR ${t.sessionRevision} >= 0`,
    ),
    check(
      'attendance_change_requests_reason',
      sql`${t.reason} = btrim(${t.reason}) AND char_length(${t.reason}) BETWEEN 1 AND 500`,
    ),
    check(
      'attendance_change_requests_decision_reason',
      sql`${t.decisionReason} IS NULL OR (${t.decisionReason} = btrim(${t.decisionReason}) AND char_length(${t.decisionReason}) BETWEEN 1 AND 500)`,
    ),
    check(
      'attendance_change_requests_pending',
      sql`${t.status} <> 'PENDING' OR (${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL AND ${t.decisionReason} IS NULL AND ${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL)`,
    ),
    check(
      'attendance_change_requests_approved',
      sql`${t.status} <> 'APPROVED' OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL)`,
    ),
    check(
      'attendance_change_requests_rejected',
      sql`${t.status} <> 'REJECTED' OR (${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.decisionReason} IS NOT NULL AND ${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL)`,
    ),
    check(
      'attendance_change_requests_cancelled',
      sql`${t.status} <> 'CANCELLED' OR (${t.cancelledBy} IS NOT NULL AND ${t.cancelledAt} IS NOT NULL AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL AND ${t.decisionReason} IS NULL)`,
    ),
  ];
}
