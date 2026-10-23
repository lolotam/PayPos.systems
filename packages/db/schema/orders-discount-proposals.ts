import { sql } from 'drizzle-orm';
import { boolean, char, check, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { businesses, branches, companies } from './tenancy.ts';
import { customers } from './customers.ts';
import { services } from './catalog.ts';
import { employees } from './staff.ts';
import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';
import { serviceLines, serviceSessions } from './orders.ts';

// طلب موافقة على خصم فوق الحد (spec 057): طلب تسجيل بند جديد وطلب تعديل بند محفوظ في الجدول نفسه (D-20)؛ الربط مع service_lines في 0163–0164، وقيود D-21 (النشاط والخدمة والزيارة وفرع الزيارة) في هجرات 057-5b.
export const discountProposals = pgTable('discount_proposals', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  requestId: uuid('request_id').notNull(),
  // موضع البند في مصفوفة الطلب؛ به يرجع كل اقتراح لسطر المسودة حتى لو تكررت الخدمة.
  inputIndex: integer('input_index').notNull(),
  // نوع الطلب: RECORD بند جديد أو EDIT بند محفوظ (D-20).
  kind: text('kind').notNull(),
  // البند الذي يعدّله طلب التعديل؛ NULL لطلب التسجيل.
  lineId: uuid('line_id'),
  // المراجعة التي يقوم عليها طلب التعديل؛ من غيرها كانت الموافقة تُستعمل على مراجعة أخرى.
  baseRevision: integer('base_revision'),
  // سعر البند وخصمه وصافيه وقت الطلب كما هما محفوظان في السطر، لا من الكتالوج.
  basePrice: numeric('base_price', { precision: 14, scale: 3 }),
  baseDiscount: numeric('base_discount', { precision: 14, scale: 3 }),
  baseNet: numeric('base_net', { precision: 14, scale: 3 }),
  sessionId: uuid('session_id'),
  // لحظة الزيارة بعد التطبيع: لحظة الجلسة المحفوظة، أو لحظة الطلب، أو الآن المحقون.
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  customerId: uuid('customer_id').notNull(),
  serviceId: uuid('service_id').notNull(),
  serviceNameEn: text('service_name_en').notNull(),
  serviceNameAr: text('service_name_ar'),
  terms: jsonb('terms').notNull(),
  termsHash: char('terms_hash', { length: 64 }).notNull(),
  effectiveBps: integer('effective_bps').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  requestedByMembershipId: uuid('requested_by_membership_id').notNull(),
  requesterLimitSource: text('requester_limit_source').notNull(),
  requesterLimitBps: integer('requester_limit_bps'),
  // لقطات D-18 وقت الطلب بشكل محرر 35d-3b؛ القوائم لا تقرأ جداول وحدة أخرى.
  requesterNameAr: text('requester_name_ar'),
  requesterNameEn: text('requester_name_en'),
  requesterRole: text('requester_role').notNull(),
  requesterRoleIsSystem: boolean('requester_role_is_system').notNull(),
  requesterRoleNameAr: text('requester_role_name_ar'),
  requesterRoleNameEn: text('requester_role_name_en').notNull(),
  requesterFirstNameEn: text('requester_first_name_en'),
  requesterFirstNameAr: text('requester_first_name_ar'),
  // الاسم الأول فقط؛ الاسم الكامل والهاتف لا يُخزَّنان أبداً.
  customerFirstName: text('customer_first_name').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  status: text('status').notNull(),
  // تنتهي صلاحية الطلب 24 ساعة من طلبه، والموافقة تعيد ضبطها 24 ساعة من لحظة الموافقة (FR-010).
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedBy: uuid('decided_by'),
  decidedByMembershipId: uuid('decided_by_membership_id'),
  decidedVia: text('decided_via'),
  decidedDeviceId: uuid('decided_device_id'),
  deciderNameAr: text('decider_name_ar'),
  deciderNameEn: text('decider_name_en'),
  deciderRole: text('decider_role'),
  deciderRoleIsSystem: boolean('decider_role_is_system'),
  deciderRoleNameAr: text('decider_role_name_ar'),
  deciderRoleNameEn: text('decider_role_name_en'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  approvedLimitSource: text('approved_limit_source'),
  approvedLimitBps: integer('approved_limit_bps'),
  // علم أن الموافقة جاءت من منفّذ البند نفسه؛ لا يمنع الموافقة بل يوقظ المالك (D-19).
  approverIsPerformer: boolean('approver_is_performer'),
  rejectReason: text('reject_reason'),
  consumedLineId: uuid('consumed_line_id'),
  // صف التعديل الذي استهلك هذه الموافقة؛ NULL لطلب التسجيل (D-20).
  consumedEditId: uuid('consumed_edit_id'),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ name: 'dp_pk', columns: [t.companyId, t.id] }),
  unique('dp_business_id_key').on(t.companyId, t.businessId, t.id),
  unique('dp_consumed_line_key').on(t.companyId, t.id, t.consumedLineId),
  unique('dp_consumed_edit_key').on(t.companyId, t.id, t.consumedEditId),
  unique('dp_request_input_key').on(t.companyId, t.requestId, t.inputIndex),
  uniqueIndex('dp_consumed_line_uq').on(t.companyId, t.consumedLineId).where(sql`${t.consumedLineId} IS NOT NULL`),
  uniqueIndex('dp_consumed_edit_uq').on(t.companyId, t.consumedEditId).where(sql`${t.consumedEditId} IS NOT NULL`),
  foreignKey({ name: 'dp_branch_fk', columns: [t.companyId, t.businessId, t.branchId], foreignColumns: [branches.companyId, branches.businessId, branches.id] }),
  foreignKey({ name: 'dp_service_fk', columns: [t.companyId, t.businessId, t.serviceId], foreignColumns: [services.companyId, services.businessId, services.id] }),
  foreignKey({ name: 'dp_session_fk', columns: [t.companyId, t.businessId, t.sessionId], foreignColumns: [serviceSessions.companyId, serviceSessions.businessId, serviceSessions.id] }),
  foreignKey({ name: 'dp_line_fk', columns: [t.companyId, t.businessId, t.lineId], foreignColumns: [serviceLines.companyId, serviceLines.businessId, serviceLines.id] }),
  foreignKey({ name: 'dp_customer_fk', columns: [t.companyId, t.customerId], foreignColumns: [customers.companyId, customers.id] }),
  foreignKey({ name: 'dp_requester_membership_fk', columns: [t.companyId, t.requestedBy, t.requestedByMembershipId], foreignColumns: [memberships.companyId, memberships.userId, memberships.id] }),
  foreignKey({ name: 'dp_decider_membership_fk', columns: [t.companyId, t.decidedBy, t.decidedByMembershipId], foreignColumns: [memberships.companyId, memberships.userId, memberships.id] }),
  index('dp_branch_status_idx').on(t.companyId, t.branchId, t.status, t.expiresAt),
  index('dp_pending_idx').on(t.companyId, t.branchId, t.requestedAt.desc(), t.id.desc()).where(sql`${t.status} = 'PENDING'`),
  index('dp_requested_by_idx').on(t.companyId, t.requestedBy, t.requestedAt.desc()),
  index('dp_branch_fk_idx').on(t.companyId, t.businessId, t.branchId),
  index('dp_session_fk_idx').on(t.companyId, t.businessId, t.sessionId).where(sql`${t.sessionId} IS NOT NULL`),
  index('dp_line_fk_idx').on(t.companyId, t.businessId, t.lineId).where(sql`${t.lineId} IS NOT NULL`),
  index('dp_consumed_edit_fk_idx').on(t.companyId, t.lineId, t.consumedEditId).where(sql`${t.consumedEditId} IS NOT NULL`),
  index('dp_customer_fk_idx').on(t.companyId, t.customerId),
  index('dp_service_fk_idx').on(t.companyId, t.businessId, t.serviceId),
  index('dp_requester_membership_idx').on(t.companyId, t.requestedBy, t.requestedByMembershipId),
  index('dp_decider_membership_idx').on(t.companyId, t.decidedBy, t.decidedByMembershipId).where(sql`${t.decidedBy} IS NOT NULL`),
  index('dp_device_fk_idx').on(t.companyId, t.branchId, t.decidedDeviceId).where(sql`${t.decidedDeviceId} IS NOT NULL`),
  check('dp_status_ck', sql`${t.status} IN ('PENDING','APPROVED','REJECTED','CONSUMED')`),
  check('dp_kind_ck', sql`(${t.kind} IN ('RECORD','EDIT')) IS TRUE`),
  // شكل الطلب حسب نوعه: طلب التسجيل بلا بند ولا لقطة سعر، وطلب التعديل باسم بند ومراجعة ولقطة سعر كاملة.
  check('dp_kind_shape_ck', sql`(((${t.kind} = 'RECORD' AND ${t.lineId} IS NULL AND ${t.baseRevision} IS NULL AND ${t.basePrice} IS NULL AND ${t.baseDiscount} IS NULL AND ${t.baseNet} IS NULL AND ${t.consumedEditId} IS NULL) OR (${t.kind} = 'EDIT' AND ${t.lineId} IS NOT NULL AND ${t.baseRevision} IS NOT NULL AND ${t.baseRevision} >= 1 AND ${t.basePrice} IS NOT NULL AND ${t.baseDiscount} IS NOT NULL AND ${t.baseNet} IS NOT NULL AND ${t.sessionId} IS NOT NULL AND ${t.inputIndex} = 0 AND ${t.consumedLineId} IS NULL))) IS TRUE`),
  check('dp_base_amounts_ck', sql`((${t.basePrice} IS NULL AND ${t.baseDiscount} IS NULL AND ${t.baseNet} IS NULL) OR (${t.basePrice} >= 0 AND ${t.baseDiscount} >= 0 AND ${t.baseDiscount} <= ${t.basePrice} AND ${t.baseNet} >= 0 AND ${t.baseNet} = ${t.basePrice} - ${t.baseDiscount})) IS TRUE`),
  check('dp_input_index_ck', sql`${t.inputIndex} BETWEEN 0 AND 19`),
  check('dp_effective_bps_ck', sql`${t.effectiveBps} BETWEEN 1 AND 10000`),
  check('dp_terms_hash_ck', sql`${t.termsHash} ~ '^[0-9a-f]{64}$'`),
  check('dp_service_names_ck', sql`char_length(trim(${t.serviceNameEn})) BETWEEN 1 AND 255 AND ${t.serviceNameEn} !~ '[[:cntrl:]]' AND (${t.serviceNameAr} IS NULL OR (char_length(trim(${t.serviceNameAr})) BETWEEN 1 AND 255 AND ${t.serviceNameAr} !~ '[[:cntrl:]]'))`),
  check('dp_requester_limit_ck', sql`((${t.requesterLimitSource}='OWNER' AND ${t.requesterLimitBps} IS NULL) OR (${t.requesterLimitSource}='NOT_CONFIGURED' AND ${t.requesterLimitBps}=0) OR (${t.requesterLimitSource} IN ('PERSON','BUSINESS') AND ${t.requesterLimitBps} BETWEEN 0 AND 10000)) IS TRUE`),
  check('dp_requester_names_ck', sql`(${t.requesterNameAr} IS NULL OR ${t.requesterNameEn} IS NOT NULL) AND (${t.requesterRoleNameAr} IS NULL OR ${t.requesterRoleNameEn} IS NOT NULL) AND ${t.requesterRole} ~ '^[a-z][a-z_]{0,63}$'`),
  check('dp_requester_lengths_ck', sql`char_length(${t.requesterNameAr}) <= 255 AND char_length(${t.requesterNameEn}) <= 255 AND char_length(${t.requesterRoleNameAr}) <= 255 AND char_length(${t.requesterRoleNameEn}) <= 255 AND char_length(${t.requesterFirstNameEn}) <= 255 AND char_length(${t.requesterFirstNameAr}) <= 255`),
  check('dp_requester_first_names_ck', sql`(${t.requesterFirstNameEn} IS NULL) = (${t.requesterNameEn} IS NULL) AND (${t.requesterFirstNameAr} IS NULL) = (${t.requesterNameAr} IS NULL)`),
  check('dp_customer_first_name_ck', sql`char_length(${t.customerFirstName}) BETWEEN 1 AND 200`),
  // من قرر وكيف ومتى ودوره: كلها موجودة إذا وفقط إذا لم يعد الطلب PENDING.
  check('dp_decision_ck', sql`(${t.status} = 'PENDING') = (${t.decidedBy} IS NULL) AND (${t.status} = 'PENDING') = (${t.decidedByMembershipId} IS NULL) AND (${t.status} = 'PENDING') = (${t.decidedVia} IS NULL) AND (${t.status} = 'PENDING') = (${t.decidedAt} IS NULL) AND (${t.status} = 'PENDING') = (${t.deciderRole} IS NULL) AND (${t.status} = 'PENDING') = (${t.deciderRoleIsSystem} IS NULL) AND (${t.status} = 'PENDING') = (${t.deciderRoleNameEn} IS NULL)`),
  // اسم المقرر اختياري بعد القرار لأن المالك قد لا يكون موظفاً، ويبقى فارغاً طالما الطلب معلق.
  check('dp_decider_names_ck', sql`(${t.status} <> 'PENDING' OR (${t.deciderNameEn} IS NULL AND ${t.deciderNameAr} IS NULL AND ${t.deciderRoleNameAr} IS NULL)) AND (${t.deciderNameAr} IS NULL OR ${t.deciderNameEn} IS NOT NULL) AND (${t.deciderRoleNameAr} IS NULL OR ${t.deciderRoleNameEn} IS NOT NULL) AND ${t.deciderRole} ~ '^[a-z][a-z_]{0,63}$'`),
  check('dp_decider_lengths_ck', sql`char_length(${t.deciderNameAr}) <= 255 AND char_length(${t.deciderNameEn}) <= 255 AND char_length(${t.deciderRoleNameAr}) <= 255 AND char_length(${t.deciderRoleNameEn}) <= 255`),
  check('dp_decided_via_ck', sql`${t.decidedVia} IN ('PIN','REMOTE') AND (${t.decidedDeviceId} IS NOT NULL) = coalesce(${t.decidedVia} = 'PIN', false)`),
  check('dp_approved_limit_ck', sql`(((${t.status} IN ('APPROVED','CONSUMED')) = (${t.approvedLimitSource} IS NOT NULL)) AND ((${t.approvedLimitSource} IS NULL AND ${t.approvedLimitBps} IS NULL) OR (${t.approvedLimitSource}='OWNER' AND ${t.approvedLimitBps} IS NULL) OR (${t.approvedLimitSource}='NOT_CONFIGURED' AND ${t.approvedLimitBps}=0) OR (${t.approvedLimitSource} IN ('PERSON','BUSINESS') AND ${t.approvedLimitBps} BETWEEN 0 AND 10000))) IS TRUE`),
  check('dp_reject_reason_ck', sql`${t.rejectReason} IS NULL OR (${t.status} = 'REJECTED' AND ${t.rejectReason} = btrim(${t.rejectReason}, chr(9) || chr(10) || chr(13) || chr(32)) AND char_length(${t.rejectReason}) BETWEEN 1 AND 500)`),
  // علم المنفّذ موجود مع كل موافقة، ومع كل حالة أخرى غايب.
  check('dp_approver_flag_ck', sql`(((${t.status} IN ('APPROVED','CONSUMED')) = (${t.approverIsPerformer} IS NOT NULL)) IS TRUE)`),
  // الاستهلاك: صف واحد لكل موافقة، وسطر لطلب التسجيل وصف تعديل لطلب التعديل.
  check('dp_consumption_ck', sql`(((${t.status} = 'CONSUMED') = (${t.consumedAt} IS NOT NULL)) AND ((${t.status} <> 'CONSUMED' AND ${t.consumedLineId} IS NULL AND ${t.consumedEditId} IS NULL) OR (${t.status} = 'CONSUMED' AND ${t.kind} = 'RECORD' AND ${t.consumedLineId} IS NOT NULL AND ${t.consumedEditId} IS NULL) OR (${t.status} = 'CONSUMED' AND ${t.kind} = 'EDIT' AND ${t.consumedEditId} IS NOT NULL AND ${t.consumedLineId} IS NULL))) IS TRUE`),
]);

// منفذو بند الطلب وقت الطلب (D-16): رابط المستخدم يبقى حتى لو تغيّر لاحقاً، فلا يوافق منفذ سابق.
export const discountProposalPerformers = pgTable('discount_proposal_performers', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  proposalId: uuid('proposal_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  linkedUserId: uuid('linked_user_id').references(() => user.id),
  firstNameEn: text('first_name_en').notNull(),
  firstNameAr: text('first_name_ar'),
}, (t) => [
  primaryKey({ name: 'dpp_pk', columns: [t.companyId, t.id] }),
  unique('dpp_proposal_employee_key').on(t.companyId, t.proposalId, t.employeeId),
  foreignKey({ name: 'dpp_proposal_fk', columns: [t.companyId, t.businessId, t.proposalId], foreignColumns: [discountProposals.companyId, discountProposals.businessId, discountProposals.id] }),
  foreignKey({ name: 'dpp_employee_fk', columns: [t.companyId, t.businessId, t.employeeId], foreignColumns: [employees.companyId, employees.businessId, employees.id] }),
  index('dpp_proposal_fk_idx').on(t.companyId, t.businessId, t.proposalId),
  index('dpp_employee_fk_idx').on(t.companyId, t.businessId, t.employeeId),
  index('dpp_linked_user_idx').on(t.linkedUserId).where(sql`${t.linkedUserId} IS NOT NULL`),
  check('dpp_first_names_ck', sql`char_length(${t.firstNameEn}) BETWEEN 1 AND 255 AND char_length(${t.firstNameAr}) <= 255`),
]);

// دفتر جرس طلب الموافقة (057-3): صف واحد لكل طلب، لأن الجرس قرار لا يُعاد. صفر مستلمين قرار نهائي لا خطأ.
export const discountApprovalNotices = pgTable('discount_approval_notices', {
  companyId: uuid('company_id').notNull(),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  requestId: uuid('request_id').notNull(),
  // المصدر محفوظ دون FK للأوتبوكس حتى لا تتوقف الحماية عند حذف الحدث القديم.
  sourceEventId: uuid('source_event_id').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull(),
  // الصفر قرار نهائي قابل للمراجعة، وليس حدثاً بمستلمين فارغين.
  recipientCount: integer('recipient_count').notNull(),
}, (t) => [
  primaryKey({ name: 'discount_approval_notices_pkey', columns: [t.companyId, t.id] }),
  unique('discount_approval_notices_request_key').on(t.companyId, t.requestId),
  foreignKey({ name: 'discount_approval_notices_company_fk', columns: [t.companyId], foreignColumns: [companies.id] }),
  foreignKey({ name: 'discount_approval_notices_business_fk', columns: [t.companyId, t.businessId], foreignColumns: [businesses.companyId, businesses.id] }),
  index('discount_approval_notices_business_fk_idx').on(t.companyId, t.businessId),
  check('discount_approval_notices_recipient_count', sql`${t.recipientCount} >= 0`),
]);
