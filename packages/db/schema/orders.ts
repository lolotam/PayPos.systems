import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies, branches } from './tenancy.ts';
import { customers } from './customers.ts';
import { services } from './catalog.ts';
import { employees } from './staff.ts';
import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';

const scope = () => ({ companyId: uuid('company_id').notNull().references(() => companies.id), id: uuid('id').notNull(), businessId: uuid('business_id').notNull() });
const recorder = () => ({ recordedBy: uuid('recorded_by').notNull().references(() => user.id), recordedByMembershipId: uuid('recorded_by_membership_id').notNull(), recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(), late: boolean('late').notNull() });
const money = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const serviceSessions = pgTable('service_sessions', {
  ...scope(), ...recorder(), branchId: uuid('branch_id').notNull(), customerId: uuid('customer_id').notNull(),
  // الاسم والهاتف المقنّع لقطة عرض آمنة؛ لا نحتاج قراءة سياق العملاء لبناء زيارة محفوظة.
  customerName: text('customer_name').notNull(), customerPhoneMasked: text('customer_phone_masked').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(), businessDate: date('business_date').notNull(),
  // تاريخ المحاسبة ثابت حتى لو تغيّرت منطقة النشاط لاحقاً.
  businessTimezone: text('business_timezone').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }), unique('service_sessions_business_id_key').on(t.companyId, t.businessId, t.id),
  foreignKey({ name: 'service_sessions_branch_fk', columns: [t.companyId, t.businessId, t.branchId], foreignColumns: [branches.companyId, branches.businessId, branches.id] }),
  foreignKey({ name: 'service_sessions_customer_fk', columns: [t.companyId, t.customerId], foreignColumns: [customers.companyId, customers.id] }),
  foreignKey({ name: 'service_sessions_recorder_fk', columns: [t.companyId, t.recordedByMembershipId], foreignColumns: [memberships.companyId, memberships.id] }),
  index('service_sessions_day_idx').on(t.companyId, t.branchId, t.businessDate, t.occurredAt, t.id),
  index('service_sessions_branch_fk_idx').on(t.companyId, t.businessId, t.branchId),
  index('service_sessions_customer_day_idx').on(t.companyId, t.customerId, t.businessId, t.businessDate, t.id),
  index('service_sessions_late_day_idx').on(t.companyId, t.branchId, t.businessDate, t.occurredAt, t.id).where(sql`${t.late}`),
  index('service_sessions_membership_idx').on(t.companyId, t.recordedByMembershipId),
  index('service_sessions_recorder_idx').on(t.companyId, t.recordedBy),
  index('service_sessions_recorded_by_fk_idx').on(t.recordedBy),
]);

export const serviceSessionRecoveries = pgTable('service_session_recoveries', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  userId: uuid('user_id').notNull(),
  operation: text('operation').notNull(),
  // هاش المفتاح فقط؛ المفتاح الخام لا يُخزَّن حتى لا يبقى سرّ العميل في صف الاسترجاع.
  keyHash: text('key_hash').notNull(),
  // يوم المحاسبة يُثبَّت عند الإصدار ولا يتبع لحظة الالتزام لو عدّت منتصف الليل.
  businessDate: date('business_date').notNull(),
  businessTimezone: text('business_timezone').notNull(),
  sessionId: uuid('session_id'),
  committedAt: timestamp('committed_at', { withTimezone: true }),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokedOutcome: text('revoked_outcome'),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }),
  unique('service_session_recoveries_attempt_key').on(t.companyId, t.userId, t.businessId, t.branchId, t.operation, t.keyHash),
  foreignKey({ name: 'service_session_recoveries_branch_fk', columns: [t.companyId, t.businessId, t.branchId], foreignColumns: [branches.companyId, branches.businessId, branches.id] }),
  foreignKey({ name: 'service_session_recoveries_session_fk', columns: [t.companyId, t.businessId, t.sessionId], foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  index('service_session_recoveries_branch_fk_idx').on(t.companyId, t.businessId, t.branchId),
  index('service_session_recoveries_session_fk_idx').on(t.companyId, t.businessId, t.sessionId),
  check('service_session_recoveries_operation', sql`${t.operation} IN ('record-service-session','append-service-session-lines')`),
  check('service_session_recoveries_lifetime', sql`${t.expiresAt} > ${t.issuedAt} AND ${t.expiresAt} <= ${t.issuedAt} + interval '168 hours'`),
  check('service_session_recoveries_revoke_pair', sql`(${t.revokedAt} IS NULL) = (${t.revokedOutcome} IS NULL)`),
  check('service_session_recoveries_outcome', sql`${t.revokedOutcome} IS NULL OR ${t.revokedOutcome} IN ('RECORDED_ELSEWHERE','NOT_RECORDED')`),
]);

export const lateServiceSessionNotices = pgTable('late_service_session_notices', {
  ...scope(), sessionId: uuid('session_id').notNull(),
  // المصدر محفوظ دون FK للأوتبوكس حتى لا تتوقف الحماية عند حذف الحدث القديم.
  sourceEventId: uuid('source_event_id').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  // الصفر قرار نهائي قابل للمراجعة، وليس حدثاً بمستلمين فارغين.
  recipientCount: integer('recipient_count').notNull(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }),
  unique('late_service_session_notices_session_key').on(t.companyId, t.sessionId),
  foreignKey({ name: 'late_service_session_notices_session_fk', columns: [t.companyId, t.businessId, t.sessionId],
    foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  index('late_service_session_notices_session_fk_idx').on(t.companyId, t.businessId, t.sessionId),
  check('late_service_session_notices_recipient_count', sql`${t.recipientCount} >= 0`),
]);

export const serviceLines = pgTable('service_lines', {
  ...scope(), ...recorder(), sessionId: uuid('session_id').notNull(), serviceId: uuid('service_id').notNull(), ordinal: integer('ordinal').notNull(),
  // الموضع في الطلب مستقل عن ترتيب الزيارة، لأن الإضافة تبدأ طلباً جديداً وقد يرفض بعض بنوده.
  inputIndex: integer('input_index').notNull(), status: text('status').notNull(), revision: integer('revision').notNull(),
  listPrice: money('list_price').notNull(), price: money('price').notNull(), discount: money('discount').notNull(), net: money('net').notNull(),
  effectiveDiscountBps: integer('effective_discount_bps').notNull(), limitBpsApplied: integer('limit_bps_applied'), limitSource: text('limit_source').notNull(),
  nameEn: text('name_en').notNull(), nameAr: text('name_ar'), catalogRevision: integer('catalog_revision').notNull(),
  // قيمة العمولة ملتقطة وقت حفظ البند؛ FIXED بالدينار وثلاث خانات مثل بقية المال.
  ruleKind: text('rule_kind').notNull(), rulePctBps: integer('rule_pct_bps'), ruleFixedAmount: money('rule_fixed_amount'),
  countsTowardThreshold: boolean('counts_toward_threshold').notNull(), hasPerformerWarning: boolean('has_performer_warning').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }), unique('service_lines_business_id_key').on(t.companyId, t.businessId, t.id),
  unique('service_lines_session_ordinal_key').on(t.companyId, t.sessionId, t.ordinal),
  foreignKey({ name: 'service_lines_session_fk', columns: [t.companyId, t.businessId, t.sessionId], foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  foreignKey({ name: 'service_lines_service_fk', columns: [t.companyId, t.businessId, t.serviceId], foreignColumns: [services.companyId, services.businessId, services.id] }),
  foreignKey({ name: 'service_lines_recorder_fk', columns: [t.companyId, t.recordedByMembershipId], foreignColumns: [memberships.companyId, memberships.id] }),
  index('service_lines_session_fk_idx').on(t.companyId, t.businessId, t.sessionId),
  index('service_lines_service_idx').on(t.companyId, t.businessId, t.serviceId),
  index('service_lines_membership_idx').on(t.companyId, t.recordedByMembershipId), index('service_lines_recorder_idx').on(t.companyId, t.recordedBy),
  index('service_lines_recorded_by_fk_idx').on(t.recordedBy),
  index('service_lines_late_session_idx').on(t.companyId, t.sessionId).where(sql`${t.late}`),
  check('service_lines_amounts', sql`${t.listPrice} >= 0 AND ${t.price} >= 0 AND ${t.discount} BETWEEN 0 AND ${t.price} AND ${t.net} = ${t.price} - ${t.discount}`),
  check('service_lines_bps', sql`${t.effectiveDiscountBps} BETWEEN 0 AND 10000`),
  check('service_lines_identity', sql`${t.ordinal} BETWEEN 1 AND 20 AND ${t.inputIndex} BETWEEN 0 AND 19 AND ${t.revision}>0 AND ${t.catalogRevision}>0 AND ${t.status} IN ('ACTIVE','CANCELLED')`),
  check('service_lines_limit', sql`(${t.limitSource}='OWNER' AND ${t.limitBpsApplied} IS NULL) OR (${t.limitSource}='NOT_CONFIGURED' AND ${t.limitBpsApplied}=0) OR (${t.limitSource} IN ('PERSON','BUSINESS') AND ${t.limitBpsApplied} BETWEEN 0 AND 10000)`),
  check('service_lines_limit_presence', sql`(${t.limitSource}='OWNER')=(${t.limitBpsApplied} IS NULL)`),
  check('service_lines_rule', sql`${t.ruleKind} IN ('FOLLOW_PLAN','ZERO','PCT','FIXED') AND (${t.ruleKind}='PCT')=(${t.rulePctBps} IS NOT NULL) AND (${t.ruleKind}='FIXED')=(${t.ruleFixedAmount} IS NOT NULL)`),
  check('service_lines_rule_values', sql`(${t.rulePctBps} IS NULL OR ${t.rulePctBps} BETWEEN 0 AND 10000) AND (${t.ruleFixedAmount} IS NULL OR ${t.ruleFixedAmount}>=0)`),
]);

export const serviceLineEdits = pgTable('service_line_edits', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  lineId: uuid('line_id').notNull(),
  // المراجعة بعد التعديل؛ القراءة اللاحقة تجد الصف بـ (line_id, revision) ولا يكفي حفظ المراجعة السابقة وحدها.
  revision: integer('revision').notNull(),
  previousRevision: integer('previous_revision').notNull(),
  previousPrice: money('previous_price').notNull(),
  previousDiscount: money('previous_discount').notNull(),
  previousNet: money('previous_net').notNull(),
  newPrice: money('new_price').notNull(),
  newDiscount: money('new_discount').notNull(),
  newNet: money('new_net').notNull(),
  previousEffectiveDiscountBps: integer('previous_effective_discount_bps').notNull(),
  previousLimitBpsApplied: integer('previous_limit_bps_applied'),
  previousLimitSource: text('previous_limit_source').notNull(),
  newEffectiveDiscountBps: integer('new_effective_discount_bps').notNull(),
  newLimitBpsApplied: integer('new_limit_bps_applied'),
  newLimitSource: text('new_limit_source').notNull(),
  // السبب نص حر يبقى في التاريخ فقط؛ حدث الجرس لا يحمله.
  reason: text('reason').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  changedBy: uuid('changed_by').notNull().references(() => user.id),
  changedByMembershipId: uuid('changed_by_membership_id').notNull(),
  // لقطة اسم الموظف وقت الحفظ؛ تبقى فارغة إذا لم يرتبط المحرر بموظف.
  editorNameAr: text('editor_name_ar'),
  editorNameEn: text('editor_name_en'),
  // لقطة الدور للجرس عند غياب الاسم. تبقى فارغة عمداً: لم يُحسم وسم من ليس مالكاً ولا مديراً بلا موظف.
  editorRole: text('editor_role'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }),
  unique('service_line_edits_line_revision_key').on(t.companyId, t.lineId, t.revision),
  foreignKey({ name: 'service_line_edits_session_fk', columns: [t.companyId, t.businessId, t.sessionId], foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  foreignKey({ name: 'service_line_edits_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'service_line_edits_membership_fk', columns: [t.companyId, t.changedByMembershipId], foreignColumns: [memberships.companyId, memberships.id] }),
  index('service_line_edits_session_fk_idx').on(t.companyId, t.businessId, t.sessionId),
  index('service_line_edits_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  index('service_line_edits_membership_idx').on(t.companyId, t.changedByMembershipId),
  index('service_line_edits_changed_by_fk_idx').on(t.changedBy),
  check('service_line_edits_revision', sql`${t.revision} = ${t.previousRevision} + 1 AND ${t.previousRevision} >= 1`),
  check('service_line_edits_previous_amounts', sql`${t.previousPrice} >= 0 AND ${t.previousDiscount} BETWEEN 0 AND ${t.previousPrice} AND ${t.previousNet} = ${t.previousPrice} - ${t.previousDiscount}`),
  check('service_line_edits_new_amounts', sql`${t.newPrice} >= 0 AND ${t.newDiscount} BETWEEN 0 AND ${t.newPrice} AND ${t.newNet} = ${t.newPrice} - ${t.newDiscount}`),
  check('service_line_edits_previous_bps', sql`${t.previousEffectiveDiscountBps} BETWEEN 0 AND 10000`),
  check('service_line_edits_new_bps', sql`${t.newEffectiveDiscountBps} BETWEEN 0 AND 10000`),
  check('service_line_edits_previous_limit', sql`(${t.previousLimitSource}='OWNER' AND ${t.previousLimitBpsApplied} IS NULL) OR (${t.previousLimitSource}='NOT_CONFIGURED' AND ${t.previousLimitBpsApplied}=0) OR (${t.previousLimitSource} IN ('PERSON','BUSINESS') AND ${t.previousLimitBpsApplied} BETWEEN 0 AND 10000)`),
  check('service_line_edits_previous_limit_presence', sql`(${t.previousLimitSource}='OWNER')=(${t.previousLimitBpsApplied} IS NULL)`),
  check('service_line_edits_new_limit', sql`(${t.newLimitSource}='OWNER' AND ${t.newLimitBpsApplied} IS NULL) OR (${t.newLimitSource}='NOT_CONFIGURED' AND ${t.newLimitBpsApplied}=0) OR (${t.newLimitSource} IN ('PERSON','BUSINESS') AND ${t.newLimitBpsApplied} BETWEEN 0 AND 10000)`),
  check('service_line_edits_new_limit_presence', sql`(${t.newLimitSource}='OWNER')=(${t.newLimitBpsApplied} IS NULL)`),
  check('service_line_edits_reason', sql`char_length(btrim(${t.reason})) BETWEEN 1 AND 500`),
  check('service_line_edits_editor_names', sql`${t.editorNameAr} IS NULL OR ${t.editorNameEn} IS NOT NULL`),
  check('service_line_edits_editor_role', sql`${t.editorRole} IN ('owner','manager')`),
]);

export const linePerformers = pgTable('line_performers', {
  ...scope(), lineId: uuid('line_id').notNull(), employeeId: uuid('employee_id').notNull(), performerOrdinal: integer('performer_ordinal').notNull(),
  shareBps: integer('share_bps').notNull(), nameEn: text('name_en').notNull(), nameAr: text('name_ar'),
  notClockedInWarning: boolean('not_clocked_in_warning').notNull(), approvedLeaveWarning: boolean('approved_leave_warning').notNull(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }), unique('line_performers_employee_key').on(t.companyId, t.lineId, t.employeeId),
  unique('line_performers_ordinal_key').on(t.companyId, t.lineId, t.performerOrdinal),
  foreignKey({ name: 'line_performers_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'line_performers_employee_fk', columns: [t.companyId, t.businessId, t.employeeId], foreignColumns: [employees.companyId, employees.businessId, employees.id] }),
  index('line_performers_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  index('line_performers_employee_idx').on(t.companyId, t.businessId, t.employeeId, t.lineId),
  check('line_performers_share', sql`${t.shareBps} BETWEEN 1 AND 10000 AND ${t.performerOrdinal} BETWEEN 1 AND 4`),
]);
