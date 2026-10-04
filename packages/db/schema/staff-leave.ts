import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { employees } from './staff.ts';
import { branches, companies } from './tenancy.ts';
import { user } from './identity-auth.ts';

type LeaveDecisionColumns = Record<
  | 'status'
  | 'startsAt'
  | 'decidedBy'
  | 'decidedAt'
  | 'cancelledBy'
  | 'cancelledAt'
  | 'rejectionReason'
  | 'decisionReason'
  | 'revokedBy'
  | 'revokedAt'
  | 'revocationReason',
  AnyPgColumn
>;
// قيود القرار والسحب في دالة مستقلة؛ سحب الموافقة يحفظ القرار الأصلي ولا يقبل بعد البداية.
function leaveDecisionChecks(t: LeaveDecisionColumns) {
  return [
    check(
      'leave_requests_decision_reason',
      sql`${t.decisionReason} IS NULL OR (char_length(${t.decisionReason}) BETWEEN 1 AND 500 AND ${t.decisionReason}=btrim(${t.decisionReason}))`,
    ),
    check(
      'leave_requests_revocation',
      sql`(${t.revokedBy} IS NULL AND ${t.revokedAt} IS NULL AND ${t.revocationReason} IS NULL) OR (${t.status}='CANCELLED' AND ${t.revokedBy} IS NOT NULL AND ${t.revokedAt} IS NOT NULL AND ${t.revokedAt}<${t.startsAt} AND ${t.revocationReason} IS NOT NULL AND char_length(${t.revocationReason}) BETWEEN 1 AND 500 AND ${t.revocationReason}=btrim(${t.revocationReason}) AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL AND ${t.rejectionReason} IS NULL)`,
    ),
  ];
}

export const leaveRequests = pgTable(
  'leave_requests',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    kind: text('kind').notNull(),
    from: date('from').notNull(),
    to: date('to').notNull(),
    start: text('start'),
    end: text('end'),
    // نحفظ المنطقة المستخدمة عند الطلب حتى لا يعيد تغيير الإعداد تفسير الإجازة.
    timezone: text('timezone').notNull(),
    // نهاية الفترة مستبعدة؛ اليوم الكامل ينتهي عند منتصف ليل اليوم التالي محلياً.
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    type: text('type').notNull(),
    note: text('note'),
    status: text('status').notNull().default('PENDING'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => user.id),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    cancelledBy: uuid('cancelled_by').references(() => user.id),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    // سبب القرار العام؛ rejection_reason يظل نسخة متوافقة للرفض القديم.
    decisionReason: text('decision_reason'),
    revokedBy: uuid('revoked_by').references(() => user.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'leave_requests_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'leave_requests_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    foreignKey({
      name: 'leave_requests_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    index('leave_requests_company_employee_period_idx').on(
      t.companyId,
      t.employeeId,
      t.startsAt,
      t.endsAt,
    ),
    index('leave_requests_company_employee_id_idx').on(t.companyId, t.employeeId, t.id),
    index('leave_requests_company_business_branch_status_id_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.status,
      t.id,
    ),
    index('leave_requests_company_business_id_idx').on(t.companyId, t.businessId, t.id),
    index('leave_requests_company_branch_idx').on(t.companyId, t.branchId),
    index('leave_requests_requested_by_idx').on(t.requestedBy),
    index('leave_requests_cancelled_by_idx').on(t.cancelledBy),
    index('leave_requests_decided_by_idx').on(t.decidedBy),
    index('leave_requests_company_revoked_by_idx').on(t.companyId, t.revokedBy),
    index('leave_requests_company_business_branch_dates_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.from,
      t.to,
      t.id,
    ),
    ...leaveDecisionChecks(t),
    check('leave_requests_type', sql`${t.type} IN ('ANNUAL','SICK','UNPAID','OTHER')`),
    check(
      'leave_requests_note',
      sql`(${t.note} IS NULL OR (char_length(${t.note}) BETWEEN 1 AND 500 AND ${t.note}=btrim(${t.note}))) AND (${t.type}<>'OTHER' OR ${t.note} IS NOT NULL)`,
    ),
    check('leave_requests_period', sql`${t.from}<=${t.to} AND ${t.startsAt}<${t.endsAt}`),
    check(
      'leave_requests_kind',
      sql`(${t.kind}='FULL_DAY' AND ${t.start} IS NULL AND ${t.end} IS NULL) OR (${t.kind}='PARTIAL' AND ${t.from}=${t.to} AND ${t.start} IS NOT NULL AND ${t.end} IS NOT NULL AND ${t.start} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.end} ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.start}<${t.end})`,
    ),
    check('leave_requests_revision', sql`${t.revision}>0`),
    check(
      'leave_requests_status',
      sql`(${t.status}='PENDING' AND ${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL AND ${t.rejectionReason} IS NULL AND ${t.decisionReason} IS NULL AND ${t.revokedBy} IS NULL) OR (${t.status}='CANCELLED' AND ${t.rejectionReason} IS NULL AND ((${t.cancelledBy} IS NOT NULL AND ${t.cancelledAt} IS NOT NULL AND ${t.decidedBy} IS NULL AND ${t.decidedAt} IS NULL AND ${t.decisionReason} IS NULL AND ${t.revokedBy} IS NULL) OR (${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.revokedBy} IS NOT NULL))) OR (${t.status} IN ('APPROVED','REJECTED') AND ${t.decidedBy} IS NOT NULL AND ${t.decidedAt} IS NOT NULL AND ${t.cancelledBy} IS NULL AND ${t.cancelledAt} IS NULL AND ${t.revokedBy} IS NULL AND ((${t.status}='APPROVED' AND ${t.rejectionReason} IS NULL) OR (${t.status}='REJECTED' AND ${t.rejectionReason} IS NOT NULL AND char_length(btrim(${t.rejectionReason})) BETWEEN 1 AND 500 AND (${t.decisionReason} IS NULL OR ${t.decisionReason}=${t.rejectionReason}))))`,
    ),
  ],
);
