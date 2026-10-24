import { sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { companies, branches } from './tenancy.ts';
import { customers } from './customers.ts';
import { services } from './catalog.ts';
import { employees } from './staff.ts';
import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';

const scope = () => ({ companyId: uuid('company_id').notNull().references(() => companies.id), id: uuid('id').notNull(), businessId: uuid('business_id').notNull() });
// معرّف المعاملة ليس قيمة يرسلها العميل؛ التريغر يستبدله دائماً لأن القيمة الافتراضية وحدها تُزوَّر.
const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });
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
  // الموافقة التي استُهلكت لهذا البند (spec 057)؛ الربط المؤجل بالاتجاهين وقيوده في الهجرتين 0163–0164، وقيود D-21 (النشاط والخدمة والزيارة وفرع الزيارة) في هجرات 057-5b.
  discountProposalId: uuid('discount_proposal_id'),
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
  // السطر هو مرساة الصف الوحيدة؛ الجلسة تُقرأ من السطر كي لا يمكن لصف أن يسمّي جلسة غير جلسة سطره.
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
  // لقطة دور العضوية التي تمّ التعديل تحتها (ADR-0045 §2): كود الدور، وهل هو دور نظام، واسماه وقت الحفظ.
  // الاسم لا يُعاد قراءته من جدول الأدوار، لأن تغيير اسم الدور بعدها لا يجب أن يغيّر صفاً التُزم به.
  editorRole: text('editor_role'),
  editorRoleIsSystem: boolean('editor_role_is_system'),
  editorRoleNameAr: text('editor_role_name_ar'),
  editorRoleNameEn: text('editor_role_name_en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }),
  unique('service_line_edits_line_revision_key').on(t.companyId, t.lineId, t.revision),
  foreignKey({ name: 'service_line_edits_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'service_line_edits_membership_fk', columns: [t.companyId, t.changedBy, t.changedByMembershipId], foreignColumns: [memberships.companyId, memberships.userId, memberships.id] }),
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
  check('service_line_edits_reason', sql`char_length(${t.reason}) <= 500 AND btrim(${t.reason}, chr(9) || chr(10) || chr(13) || chr(32)) <> ''`),
  check('service_line_edits_editor_names', sql`${t.editorNameAr} IS NULL OR ${t.editorNameEn} IS NOT NULL`),
  check('service_line_edits_editor_role', sql`${t.editorRole} ~ '^[a-z][a-z_]{0,63}$'`),
  check('service_line_edits_editor_role_snapshot', sql`(${t.editorRole} IS NULL) = (${t.editorRoleIsSystem} IS NULL) AND (${t.editorRole} IS NULL) = (${t.editorRoleNameEn} IS NULL) AND (${t.editorRoleNameAr} IS NULL OR ${t.editorRoleNameEn} IS NOT NULL)`),
  check('service_line_edits_editor_name_length', sql`char_length(${t.editorNameAr}) <= 255 AND char_length(${t.editorNameEn}) <= 255 AND char_length(${t.editorRoleNameAr}) <= 255 AND char_length(${t.editorRoleNameEn}) <= 255`),
  check('service_line_edits_editor_identity', sql`${t.editorNameEn} IS NOT NULL OR ${t.editorRole} IS NOT NULL`),
]);

export const serviceLineEditNotices = pgTable('service_line_edit_notices', {
  ...scope(), sessionId: uuid('session_id').notNull(), lineId: uuid('line_id').notNull(),
  // الجرس مرة لكل (سطر، مراجعة) لا لكل زيارة؛ تعديل ثانٍ أو سطر آخر يقرع من جديد.
  revision: integer('revision').notNull(),
  // المصدر محفوظ دون FK للأوتبوكس حتى لا تتوقف الحماية عند حذف الحدث القديم.
  sourceEventId: uuid('source_event_id').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  recipientCount: integer('recipient_count').notNull(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }),
  unique('service_line_edit_notices_line_revision_key').on(t.companyId, t.lineId, t.revision),
  foreignKey({ name: 'service_line_edit_notices_session_fk', columns: [t.companyId, t.businessId, t.sessionId],
    foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  foreignKey({ name: 'service_line_edit_notices_line_fk', columns: [t.companyId, t.businessId, t.lineId],
    foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  index('service_line_edit_notices_session_fk_idx').on(t.companyId, t.businessId, t.sessionId),
  index('service_line_edit_notices_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  check('service_line_edit_notices_recipient_count', sql`${t.recipientCount} >= 0`),
]);

export const linePerformers = pgTable('line_performers', {
  ...scope(), lineId: uuid('line_id').notNull(), employeeId: uuid('employee_id').notNull(), performerOrdinal: integer('performer_ordinal').notNull(),
  shareBps: integer('share_bps').notNull(), nameEn: text('name_en').notNull(), nameAr: text('name_ar'),
  notClockedInWarning: boolean('not_clocked_in_warning').notNull(), approvedLeaveWarning: boolean('approved_leave_warning').notNull(),
  // المستخدم المرتبط بالموظف لحظة تسجيل البند (ADR-0045 §1)، لا الرابط الحالي؛ لا يتغير بعد الإدخال ولا منحة UPDATE عليه.
  linkedUserId: uuid('linked_user_id').references(() => user.id),
  // false يعني أن الصف سُجّل قبل وجود اللقطة أو بنسخة قديمة أثناء النشر؛ التعديل يرفض البند عندها لأن هوية المنفذ لا تُثبَت.
  linkedUserSnapshotted: boolean('linked_user_snapshotted').notNull().default(false),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.id] }), unique('line_performers_employee_key').on(t.companyId, t.lineId, t.employeeId),
  unique('line_performers_ordinal_key').on(t.companyId, t.lineId, t.performerOrdinal),
  foreignKey({ name: 'line_performers_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'line_performers_employee_fk', columns: [t.companyId, t.businessId, t.employeeId], foreignColumns: [employees.companyId, employees.businessId, employees.id] }),
  index('line_performers_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  index('line_performers_employee_idx').on(t.companyId, t.businessId, t.employeeId, t.lineId),
  index('line_performers_linked_user_idx').on(t.linkedUserId).where(sql`${t.linkedUserId} IS NOT NULL`),
  check('line_performers_linked_user_snapshot', sql`${t.linkedUserId} IS NULL OR ${t.linkedUserSnapshotted}`),
  check('line_performers_share', sql`${t.shareBps} BETWEEN 1 AND 10000 AND ${t.performerOrdinal} BETWEEN 1 AND 4`),
]);

export const serviceLinePerformerChanges = pgTable('service_line_performer_changes', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  // السطر هو مرساة الصف الوحيدة؛ الجلسة تُقرأ منه حتى لا يسمي التاريخ سطراً من زيارة أخرى.
  lineId: uuid('line_id').notNull(),
  revision: integer('revision').notNull(),
  previousRevision: integer('previous_revision').notNull(),
  reason: text('reason').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  changedBy: uuid('changed_by').notNull(),
  changedByMembershipId: uuid('changed_by_membership_id').notNull(),
  changerNameAr: text('changer_name_ar'),
  changerNameEn: text('changer_name_en'),
  // لقطة دور العضوية وقت التغيير، بنفس قاعدة 35d-3b: الكود والأسماء لا تُعاد قراءتها من جدول الأدوار.
  changerRole: text('changer_role'),
  changerRoleIsSystem: boolean('changer_role_is_system'),
  changerRoleNameAr: text('changer_role_name_ar'),
  changerRoleNameEn: text('changer_role_name_en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  writeXid: xid8('write_xid').notNull(),
  // 0 = صف اتكتب قبل الختم المزدوج: معرّف ما يملكوش أي cluster، فعمره ما يتحسب رأس المعاملة الحالية (ADR-0050).
  writeSystemId: bigint('write_system_id', { mode: 'bigint' }).notNull().default(sql`0`),
}, (t) => [
  primaryKey({ name: 'slpc_pk', columns: [t.companyId, t.id] }),
  unique('slpc_line_revision_uq').on(t.companyId, t.lineId, t.revision),
  unique('slpc_business_id_uq').on(t.companyId, t.businessId, t.id),
  unique('slpc_line_xid_uq').on(t.companyId, t.lineId, t.writeSystemId, t.writeXid),
  foreignKey({ name: 'slpc_company_fk', columns: [t.companyId], foreignColumns: [companies.id] }),
  foreignKey({ name: 'slpc_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'slpc_membership_fk', columns: [t.companyId, t.changedBy, t.changedByMembershipId], foreignColumns: [memberships.companyId, memberships.userId, memberships.id] }),
  foreignKey({ name: 'slpc_actor_fk', columns: [t.changedBy], foreignColumns: [user.id] }),
  index('slpc_history_idx').on(t.companyId, t.businessId, t.lineId, t.revision.desc()),
  index('slpc_membership_idx').on(t.companyId, t.changedBy, t.changedByMembershipId),
  index('slpc_actor_idx').on(t.changedBy),
  check('slpc_revision_ck', sql`${t.previousRevision} >= 1 AND ${t.revision} = ${t.previousRevision} + 1`),
  check('slpc_reason_ck', sql`${t.reason} = btrim(${t.reason}, chr(9) || chr(10) || chr(13) || chr(32)) AND char_length(${t.reason}) BETWEEN 1 AND 500`),
  check('slpc_changer_names_ck', sql`${t.changerNameAr} IS NULL OR ${t.changerNameEn} IS NOT NULL`),
  check('slpc_changer_role_ck', sql`${t.changerRole} ~ '^[a-z][a-z_]{0,63}$'`),
  check('slpc_changer_role_snapshot_ck', sql`(${t.changerRole} IS NULL) = (${t.changerRoleIsSystem} IS NULL) AND (${t.changerRole} IS NULL) = (${t.changerRoleNameEn} IS NULL) AND (${t.changerRoleNameAr} IS NULL OR ${t.changerRoleNameEn} IS NOT NULL)`),
  check('slpc_changer_identity_ck', sql`${t.changerNameEn} IS NOT NULL OR ${t.changerRole} IS NOT NULL`),
  check('slpc_changer_lengths_ck', sql`char_length(${t.changerNameAr}) <= 255 AND char_length(${t.changerNameEn}) <= 255 AND char_length(${t.changerRoleNameAr}) <= 255 AND char_length(${t.changerRoleNameEn}) <= 255`),
]);

export const serviceLinePerformerChangeRows = pgTable('service_line_performer_change_rows', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  changeId: uuid('change_id').notNull(),
  // لا line_id هنا: الرأس يسمي سطراً واحداً، وتكرار السطر يفتح صفاً يخالف رأسه.
  side: text('side').notNull(),
  employeeId: uuid('employee_id').notNull(),
  performerOrdinal: integer('performer_ordinal').notNull(),
  shareBps: integer('share_bps').notNull(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar'),
  linkedUserId: uuid('linked_user_id'),
  linkedUserSnapshotted: boolean('linked_user_snapshotted').notNull(),
  // التحذيران جزء من مجموعة المقارنة؛ NULL كان سيخفي فرقاً بين الصف الحي والتاريخ.
  notClockedInWarning: boolean('not_clocked_in_warning').notNull(),
  approvedLeaveWarning: boolean('approved_leave_warning').notNull(),
}, (t) => [
  primaryKey({ name: 'slpcr_pk', columns: [t.companyId, t.id] }),
  unique('slpcr_employee_uq').on(t.companyId, t.changeId, t.side, t.employeeId),
  unique('slpcr_ordinal_uq').on(t.companyId, t.changeId, t.side, t.performerOrdinal),
  foreignKey({ name: 'slpcr_company_fk', columns: [t.companyId], foreignColumns: [companies.id] }),
  foreignKey({ name: 'slpcr_change_fk', columns: [t.companyId, t.businessId, t.changeId], foreignColumns: [serviceLinePerformerChanges.companyId, serviceLinePerformerChanges.businessId, serviceLinePerformerChanges.id] }),
  foreignKey({ name: 'slpcr_employee_fk', columns: [t.companyId, t.businessId, t.employeeId], foreignColumns: [employees.companyId, employees.businessId, employees.id] }),
  foreignKey({ name: 'slpcr_user_fk', columns: [t.linkedUserId], foreignColumns: [user.id] }),
  index('slpcr_change_fk_idx').on(t.companyId, t.businessId, t.changeId),
  index('slpcr_employee_idx').on(t.companyId, t.businessId, t.employeeId),
  index('slpcr_user_idx').on(t.linkedUserId).where(sql`${t.linkedUserId} IS NOT NULL`),
  check('slpcr_side_ck', sql`${t.side} IN ('BEFORE','AFTER')`),
  check('slpcr_share_ordinal_ck', sql`${t.shareBps} BETWEEN 1 AND 10000 AND ${t.performerOrdinal} BETWEEN 1 AND 4`),
  check('slpcr_snapshot_ck', sql`${t.linkedUserId} IS NULL OR ${t.linkedUserSnapshotted}`),
]);

export const serviceLineCancellations = pgTable('service_line_cancellations', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  // السطر هو مرساة الصف الوحيدة؛ الجلسة تُقرأ منه حتى لا يسمي الإلغاء زيارة غير زيارة سطره.
  lineId: uuid('line_id').notNull(),
  revision: integer('revision').notNull(),
  previousRevision: integer('previous_revision').notNull(),
  // نسخة أرقام السطر وقت الإلغاء؛ البند الملغي لا يتغير بعدها فالمطابقة تبقى صحيحة بعد الاستعادة.
  previousPrice: money('previous_price').notNull(),
  previousDiscount: money('previous_discount').notNull(),
  previousNet: money('previous_net').notNull(),
  cancelledBy: uuid('cancelled_by').notNull(),
  cancelledByMembershipId: uuid('cancelled_by_membership_id').notNull(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }).notNull(),
  reason: text('reason').notNull(),
  cancellerNameAr: text('canceller_name_ar'),
  cancellerNameEn: text('canceller_name_en'),
  // لقطة دور العضوية وقت الإلغاء، بنفس قاعدة 35d-3b: الكود والأسماء لا تُعاد قراءتها من جدول الأدوار.
  cancellerRole: text('canceller_role'),
  cancellerRoleIsSystem: boolean('canceller_role_is_system'),
  cancellerRoleNameAr: text('canceller_role_name_ar'),
  cancellerRoleNameEn: text('canceller_role_name_en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'slc_pk', columns: [t.companyId, t.id] }),
  unique('slc_line_uq').on(t.companyId, t.lineId),
  foreignKey({ name: 'slc_company_fk', columns: [t.companyId], foreignColumns: [companies.id] }),
  foreignKey({ name: 'slc_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'slc_membership_fk', columns: [t.companyId, t.cancelledBy, t.cancelledByMembershipId], foreignColumns: [memberships.companyId, memberships.userId, memberships.id] }),
  foreignKey({ name: 'slc_actor_fk', columns: [t.cancelledBy], foreignColumns: [user.id] }),
  index('slc_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  index('slc_membership_idx').on(t.companyId, t.cancelledBy, t.cancelledByMembershipId),
  index('slc_actor_idx').on(t.cancelledBy),
  check('slc_revision_ck', sql`${t.previousRevision} >= 1 AND ${t.revision} = ${t.previousRevision} + 1`),
  // الحد الأعلى سقف numeric لرفض NaN، مش سقفاً تجارياً.
  check('slc_previous_amounts_ck', sql`${t.previousPrice} >= 0 AND ${t.previousPrice} <= 99999999999.999 AND ${t.previousDiscount} BETWEEN 0 AND ${t.previousPrice} AND ${t.previousNet} = ${t.previousPrice} - ${t.previousDiscount}`),
  check('slc_reason_ck', sql`${t.reason} = btrim(${t.reason}, chr(9) || chr(10) || chr(13) || chr(32)) AND char_length(${t.reason}) BETWEEN 1 AND 500`),
  check('slc_canceller_names_ck', sql`${t.cancellerNameAr} IS NULL OR ${t.cancellerNameEn} IS NOT NULL`),
  check('slc_canceller_role_ck', sql`${t.cancellerRole} ~ '^[a-z][a-z_]{0,63}$'`),
  check('slc_canceller_role_snapshot_ck', sql`(${t.cancellerRole} IS NULL) = (${t.cancellerRoleIsSystem} IS NULL) AND (${t.cancellerRole} IS NULL) = (${t.cancellerRoleNameEn} IS NULL) AND (${t.cancellerRoleNameAr} IS NULL OR ${t.cancellerRoleNameEn} IS NOT NULL)`),
  check('slc_canceller_identity_ck', sql`${t.cancellerNameEn} IS NOT NULL OR ${t.cancellerRole} IS NOT NULL`),
  check('slc_canceller_lengths_ck', sql`char_length(${t.cancellerNameAr}) <= 255 AND char_length(${t.cancellerNameEn}) <= 255 AND char_length(${t.cancellerRoleNameAr}) <= 255 AND char_length(${t.cancellerRoleNameEn}) <= 255`),
]);

export const serviceLineCancelNotices = pgTable('service_line_cancel_notices', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  // الجلسة تُشتق من السطر؛ تخزينها هنا يسمح بجرس يسمي زيارة غير زيارة الإلغاء.
  lineId: uuid('line_id').notNull(),
  // الإلغاء يستهلك مراجعة بعد التسجيل، فمراجعة الجرس لا تكون 1.
  revision: integer('revision').notNull(),
  // المصدر محفوظ دون FK للأوتبوكس حتى لا تتوقف الحماية عند حذف الحدث القديم.
  sourceEventId: uuid('source_event_id').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  // الصفر قرار نهائي قابل للمراجعة، وليس حدثاً بمستلمين فارغين.
  recipientCount: integer('recipient_count').notNull(),
}, (t) => [
  primaryKey({ name: 'service_line_cancel_notices_pkey', columns: [t.companyId, t.id] }),
  unique('service_line_cancel_notices_line_revision_key').on(t.companyId, t.lineId, t.revision),
  foreignKey({
    name: 'service_line_cancel_notices_company_fk',
    columns: [t.companyId],
    foreignColumns: [companies.id],
  }),
  foreignKey({
    name: 'service_line_cancel_notices_line_fk',
    columns: [t.companyId, t.businessId, t.lineId],
    foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id],
  }),
  foreignKey({
    name: 'service_line_cancel_notices_cancellation_fk',
    columns: [t.companyId, t.lineId],
    foreignColumns: [serviceLineCancellations.companyId, serviceLineCancellations.lineId],
  }),
  index('service_line_cancel_notices_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  check('service_line_cancel_notices_recipient_count', sql`${t.recipientCount} >= 0`),
  check('service_line_cancel_notices_revision', sql`${t.revision} >= 2`),
]);

export const serviceLinePerformerNotices = pgTable('service_line_performer_notices', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  // الجلسة تُشتق من السطر؛ تخزينها هنا يسمح بجرس يسمي زيارة غير زيارة التغيير.
  lineId: uuid('line_id').notNull(),
  // تغيير المنفّذين يستهلك مراجعة بعد التسجيل، فمراجعة الجرس لا تكون 1.
  revision: integer('revision').notNull(),
  // المصدر محفوظ دون FK للأوتبوكس حتى لا تتوقف الحماية عند حذف الحدث القديم.
  sourceEventId: uuid('source_event_id').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  // الصفر قرار نهائي قابل للمراجعة، وليس حدثاً بمستلمين فارغين.
  recipientCount: integer('recipient_count').notNull(),
}, (t) => [
  primaryKey({ name: 'service_line_performer_notices_pkey', columns: [t.companyId, t.id] }),
  unique('service_line_performer_notices_line_revision_key').on(t.companyId, t.lineId, t.revision),
  foreignKey({ name: 'service_line_performer_notices_company_fk', columns: [t.companyId], foreignColumns: [companies.id] }),
  foreignKey({ name: 'service_line_performer_notices_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'service_line_performer_notices_change_fk', columns: [t.companyId, t.lineId, t.revision], foreignColumns: [serviceLinePerformerChanges.companyId, serviceLinePerformerChanges.lineId, serviceLinePerformerChanges.revision] }),
  index('service_line_performer_notices_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  check('service_line_performer_notices_recipient_count', sql`${t.recipientCount} >= 0`),
  check('service_line_performer_notices_revision', sql`${t.revision} >= 2`),
]);

export const sessionTipRevisions = pgTable('session_tip_revisions', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  revision: integer('revision').notNull(),
  // السلسلة معلنة بالصف السابق؛ فجوة الرقم ترفضها المرجعية من غير تريغر max()+1 ولا قفل استشاري.
  previousRevision: integer('previous_revision'),
  changedBy: uuid('changed_by').notNull(),
  changedByMembershipId: uuid('changed_by_membership_id').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  // المراجعة الأولى بلا سبب (TP-Q5)؛ الاستبدال يرفض الغياب بقيد منفصل عن شكل النص.
  reason: text('reason'),
  // بلا مفتاح للأوتبوكس: الصف يُمسح لاحقاً ودور التطبيق إدخال فقط، وربط الحدث يُفحص في حالة الاستخدام.
  eventId: uuid('event_id').notNull(),
  writeXid: xid8('write_xid').notNull(),
  // 0 = صف اتكتب قبل الختم المزدوج: معرّف ما يملكوش أي cluster، فعمره ما يتحسب رأس المعاملة الحالية (ADR-0050).
  writeSystemId: bigint('write_system_id', { mode: 'bigint' }).notNull().default(sql`0`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'session_tip_revisions_pk', columns: [t.companyId, t.id] }),
  unique('session_tip_revisions_session_revision_uq').on(t.companyId, t.sessionId, t.revision),
  unique('session_tip_revisions_event_uq').on(t.companyId, t.eventId),
  unique('session_tip_revisions_business_session_id_uq').on(t.companyId, t.businessId, t.sessionId, t.id),
  unique('session_tip_revisions_session_xid_uq').on(t.companyId, t.sessionId, t.writeSystemId, t.writeXid),
  foreignKey({ name: 'session_tip_revisions_company_fk', columns: [t.companyId], foreignColumns: [companies.id] }),
  foreignKey({ name: 'session_tip_revisions_session_fk', columns: [t.companyId, t.businessId, t.sessionId], foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  foreignKey({ name: 'session_tip_revisions_previous_fk', columns: [t.companyId, t.sessionId, t.previousRevision], foreignColumns: [t.companyId, t.sessionId, t.revision] }),
  foreignKey({ name: 'session_tip_revisions_membership_fk', columns: [t.companyId, t.changedBy, t.changedByMembershipId], foreignColumns: [memberships.companyId, memberships.userId, memberships.id] }),
  foreignKey({ name: 'session_tip_revisions_actor_fk', columns: [t.changedBy], foreignColumns: [user.id] }),
  index('session_tip_revisions_membership_idx').on(t.companyId, t.changedBy, t.changedByMembershipId),
  index('session_tip_revisions_actor_idx').on(t.changedBy),
  index('session_tip_revisions_previous_idx').on(t.companyId, t.sessionId, t.previousRevision),
  // CHECK ينجح على UNKNOWN؛ من غير coalesce مراجعة أولى غير 1 وprevious فارغ كانت هتتخزن.
  check('session_tip_revisions_revision_ck', sql`coalesce((${t.revision} = 1 AND ${t.previousRevision} IS NULL) OR (${t.revision} >= 2 AND ${t.previousRevision} = ${t.revision} - 1), false)`),
  check('session_tip_revisions_reason_required_ck', sql`${t.revision} = 1 OR ${t.reason} IS NOT NULL`),
  check('session_tip_revisions_reason_ck', sql`${t.reason} IS NULL OR (${t.reason} = btrim(${t.reason}, chr(9) || chr(10) || chr(13) || chr(32)) AND char_length(${t.reason}) BETWEEN 1 AND 500)`),
]);

export const sessionTips = pgTable('session_tips', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  revisionId: uuid('revision_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  method: text('method').notNull(),
  // الحد الأعلى سقف النوع لرفض NaN؛ سقف البقشيش التجاري يبقى في الدومين (TP-Q7).
  amount: money('amount').notNull(),
}, (t) => [
  primaryKey({ name: 'session_tips_pk', columns: [t.companyId, t.id] }),
  unique('session_tips_entry_uq').on(t.companyId, t.revisionId, t.employeeId, t.method),
  foreignKey({ name: 'session_tips_company_fk', columns: [t.companyId], foreignColumns: [companies.id] }),
  foreignKey({ name: 'session_tips_revision_fk', columns: [t.companyId, t.businessId, t.sessionId, t.revisionId], foreignColumns: [sessionTipRevisions.companyId, sessionTipRevisions.businessId, sessionTipRevisions.sessionId, sessionTipRevisions.id] }),
  foreignKey({ name: 'session_tips_session_fk', columns: [t.companyId, t.businessId, t.sessionId], foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  foreignKey({ name: 'session_tips_employee_fk', columns: [t.companyId, t.businessId, t.employeeId], foreignColumns: [employees.companyId, employees.businessId, employees.id] }),
  index('session_tips_session_revision_idx').on(t.companyId, t.businessId, t.sessionId, t.revisionId),
  index('session_tips_employee_idx').on(t.companyId, t.businessId, t.employeeId),
  check('session_tips_method_ck', sql`${t.method} IN ('CASH','CARD')`),
  check('session_tips_amount_ck', sql`${t.amount} > 0 AND ${t.amount} <= 99999999999.999`),
]);
