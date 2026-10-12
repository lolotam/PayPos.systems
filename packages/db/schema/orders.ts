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
