import { sql, type BuildExtraConfigColumns, type SQLWrapper } from 'drizzle-orm';
import {
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';
import { employees } from './staff.ts';
import { branches, businesses, companies } from './tenancy.ts';

const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });

// نمط الشهر: YYYY-MM بس؛ وسنة 0000 مرفوضة لأن to_date مش بيعرف يحوّلها.
const PERIOD_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$';

const periodFormat = (column: SQLWrapper) =>
  sql`${column} ~ ${sql.raw(`'${PERIOD_PATTERN}'`)} AND substr(${column}, 1, 4) <> '0000'`;

const commissionStatementsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  // شهر كشف العمولة بصيغة YYYY-MM حسب التقويم المحلي للنشاط.
  period: char('period', { length: 7 }).notNull(),
  status: text('status').notNull().default('DRAFT'),
  // بصمة مدخلات الشهر في حالته دلوقتي: الكاتبين بيعادوا حسابها، والمراجعة والاعتماد بيقارنوا بيها.
  currentFingerprint: char('current_fingerprint', { length: 64 }),
  // بصمة المدخلات اللي المراجع شافها وقت المراجعة.
  reviewedFingerprint: char('reviewed_fingerprint', { length: 64 }),
  // بصمة الكشف (الصفوف المجمّدة والمرفقات) اللي المراجع شافها.
  reviewedStatementFingerprint: char('reviewed_statement_fingerprint', { length: 64 }),
  // بصمة المدخلات المجمّدة عند الاعتماد، وهي نفس بصمة المراجعة.
  inputFingerprint: char('input_fingerprint', { length: 64 }),
  // بصمة الكشف المجمّدة عند الاعتماد، وهي نفس بصمة المراجعة، وبتتحسب تاني من الصفوف المجمّدة.
  statementFingerprint: char('statement_fingerprint', { length: 64 }),
  reviewedBy: uuid('reviewed_by').references(() => user.id),
  reviewedMembershipId: uuid('reviewed_membership_id'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => user.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  // لا تكتبه إلا قاعدة البيانات عند الاعتماد؛ هو دليل تريغر التجميد على معاملة الاعتماد نفسها.
  approvalXactId: xid8('approval_xact_id'),
  revision: integer('revision').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

type StatementSelf = BuildExtraConfigColumns<string, typeof commissionStatementsColumns, 'pg'>;

const statementKeys = (t: StatementSelf) => [
  primaryKey({ name: 'commission_statements_pkey', columns: [t.companyId, t.id] }),
  unique('commission_statements_period_key').on(t.companyId, t.businessId, t.period),
  unique('commission_statements_period_id_key').on(t.companyId, t.businessId, t.period, t.id),
  unique('commission_statements_company_business_id_key').on(t.companyId, t.businessId, t.id),
];

const statementRelations = (t: StatementSelf) => [
  foreignKey({
    name: 'commission_statements_business_fk',
    columns: [t.companyId, t.businessId],
    foreignColumns: [businesses.companyId, businesses.id],
  }),
  foreignKey({
    // المراجع والعضوية لازم يكونوا لنفس الشخص: المفتاح المركّب على (الشركة، اليوزر، العضوية).
    name: 'commission_statements_reviewed_membership_fk',
    columns: [t.companyId, t.reviewedBy, t.reviewedMembershipId],
    foreignColumns: [memberships.companyId, memberships.userId, memberships.id],
  }),
];

const statementChecks = (t: StatementSelf) => [
  check('commission_statements_period', sql`${periodFormat(t.period)}`),
  check('commission_statements_status', sql`${t.status} IN ('DRAFT','REVIEWED','APPROVED','PAID')`),
  check(
    'commission_statements_fingerprints',
    sql`(${t.currentFingerprint} IS NULL OR ${t.currentFingerprint} ~ '^[0-9a-f]{64}$')
        AND (${t.reviewedFingerprint} IS NULL OR ${t.reviewedFingerprint} ~ '^[0-9a-f]{64}$')
        AND (${t.reviewedStatementFingerprint} IS NULL OR ${t.reviewedStatementFingerprint} ~ '^[0-9a-f]{64}$')
        AND (${t.inputFingerprint} IS NULL OR ${t.inputFingerprint} ~ '^[0-9a-f]{64}$')
        AND (${t.statementFingerprint} IS NULL OR ${t.statementFingerprint} ~ '^[0-9a-f]{64}$')`,
  ),
  check('commission_statements_revision', sql`${t.revision} >= 0`),
  check(
    'commission_statements_stage',
    sql`(${t.status} = 'DRAFT' AND ${t.reviewedFingerprint} IS NULL
          AND ${t.reviewedStatementFingerprint} IS NULL AND ${t.reviewedBy} IS NULL
          AND ${t.reviewedMembershipId} IS NULL AND ${t.reviewedAt} IS NULL
          AND ${t.inputFingerprint} IS NULL AND ${t.statementFingerprint} IS NULL
          AND ${t.approvedBy} IS NULL AND ${t.approvedAt} IS NULL AND ${t.approvalXactId} IS NULL)
        OR (${t.status} = 'REVIEWED' AND ${t.reviewedFingerprint} IS NOT NULL
          AND ${t.reviewedStatementFingerprint} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL
          AND ${t.reviewedMembershipId} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL
          AND ${t.inputFingerprint} IS NULL AND ${t.statementFingerprint} IS NULL
          AND ${t.approvedBy} IS NULL AND ${t.approvedAt} IS NULL AND ${t.approvalXactId} IS NULL)
        OR (${t.status} IN ('APPROVED','PAID') AND ${t.reviewedFingerprint} IS NOT NULL
          AND ${t.reviewedStatementFingerprint} IS NOT NULL AND ${t.reviewedBy} IS NOT NULL
          AND ${t.reviewedMembershipId} IS NOT NULL AND ${t.reviewedAt} IS NOT NULL
          AND ${t.inputFingerprint} IS NOT NULL AND ${t.statementFingerprint} IS NOT NULL
          AND ${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL AND ${t.approvalXactId} IS NOT NULL
          AND ${t.statementFingerprint} = ${t.reviewedStatementFingerprint})`,
  ),
  // الاعتماد ما يقدرش يغيّر مدخلات غير اللي اتراجعت: الاعتماد بيعيد حساب البصمة تحت القفل
  // ويقارنها ببصمة المراجعة، واللي بيتجمّد هو نفس القيمة دي (D-5 و FR-032).
  check(
    'commission_statements_input_matches_review',
    sql`${t.status} NOT IN ('APPROVED','PAID') OR ${t.inputFingerprint} = ${t.reviewedFingerprint}`,
  ),
];

const statementIndexes = (t: StatementSelf) => [
  index('commission_statements_reviewed_by_idx').on(t.reviewedBy),
  index('commission_statements_approved_by_idx').on(t.approvedBy),
  index('commission_statements_reviewed_membership_idx').on(
    t.companyId,
    t.reviewedBy,
    t.reviewedMembershipId,
  ),
];

export const commissionStatements = pgTable(
  'commission_statements',
  commissionStatementsColumns,
  (t) => [
    ...statementKeys(t),
    ...statementRelations(t),
    ...statementChecks(t),
    ...statementIndexes(t),
  ],
);

const commissionStatementLinesColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  statementId: uuid('statement_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  employeeNumber: integer('employee_number').notNull(),
  employeeNameAr: text('employee_name_ar'),
  employeeNameEn: text('employee_name_en').notNull(),
  // مرجع المصدر المجمّد؛ لا يعتمد على بقاء صف المصدر في وحدة أخرى.
  sourceRef: text('source_ref').notNull(),
  kind: text('kind').notNull(),
  amount: numeric('amount', { precision: 14, scale: 3 }).notNull(),
  previousAmount: numeric('previous_amount', { precision: 14, scale: 3 }),
  newAmount: numeric('new_amount', { precision: 14, scale: 3 }),
  sourcePeriod: char('source_period', { length: 7 }),
  sourceBranchId: uuid('source_branch_id'),
  sourceBusinessDate: date('source_business_date'),
  // مفتاح ترشيح الفروع بعد التجميد؛ لا يُعاد حسابه من ارتباطات الموظف الحية.
  attachedBranchIds: uuid('attached_branch_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  lineId: uuid('line_id'),
  sessionId: uuid('session_id'),
  serviceId: uuid('service_id'),
  serviceNameAr: text('service_name_ar'),
  serviceNameEn: text('service_name_en'),
  customerId: uuid('customer_id'),
  // الاسم وحده لقطة مجمدة؛ لا يُحفظ هاتف العميل هنا أبداً (D-20 وD-21).
  customerName: text('customer_name'),
  businessDate: date('business_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

type LineSelf = BuildExtraConfigColumns<string, typeof commissionStatementLinesColumns, 'pg'>;

const lineKeys = (t: LineSelf) => [
  primaryKey({ name: 'commission_statement_lines_pkey', columns: [t.companyId, t.id] }),
  unique('commission_statement_lines_source_key').on(
    t.companyId,
    t.statementId,
    t.employeeId,
    t.sourceRef,
  ),
];

const lineRelations = (t: LineSelf) => [
  foreignKey({
    name: 'commission_statement_lines_statement_fk',
    columns: [t.companyId, t.businessId, t.statementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    name: 'commission_statement_lines_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
  foreignKey({
    name: 'commission_statement_lines_source_branch_fk',
    columns: [t.companyId, t.businessId, t.sourceBranchId],
    foreignColumns: [branches.companyId, branches.businessId, branches.id],
  }),
];

const lineMoneyChecks = (t: LineSelf) => [
  check(
    'commission_statement_lines_amounts',
    sql`${t.amount} <> 'NaN'::numeric
        AND (${t.previousAmount} IS NULL OR ${t.previousAmount} <> 'NaN'::numeric)
        AND (${t.newAmount} IS NULL OR ${t.newAmount} <> 'NaN'::numeric)`,
  ),
  check(
    'commission_statement_lines_correction_amounts',
    sql`(${t.kind} IN ('CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH')
          AND ${t.previousAmount} IS NOT NULL AND ${t.newAmount} IS NOT NULL
          AND ${t.amount} = ${t.newAmount} - ${t.previousAmount})
        OR (${t.kind} NOT IN ('CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH')
          AND ${t.previousAmount} IS NULL AND ${t.newAmount} IS NULL)`,
  ),
];

const lineChecks = (t: LineSelf) => [
  check(
    'commission_statement_lines_kind',
    sql`${t.kind} IN ('COMMISSION','SALE','TIP_CARD','TIP_CASH','CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH','CARRY_COMMISSION','CARRY_TIP_CARD','EMPLOYEE')`,
  ),
  ...lineMoneyChecks(t),
  check(
    'commission_statement_lines_source_fields',
    sql`(${t.sourceBranchId} IS NULL) = (${t.kind} IN ('EMPLOYEE','CARRY_COMMISSION','CARRY_TIP_CARD'))
        AND (${t.sourceBusinessDate} IS NULL) = (${t.kind} IN ('EMPLOYEE','CARRY_COMMISSION','CARRY_TIP_CARD'))`,
  ),
  check(
    'commission_statement_lines_carry_branches',
    sql`${t.kind} NOT IN ('CARRY_COMMISSION','CARRY_TIP_CARD') OR cardinality(${t.attachedBranchIds}) = 0`,
  ),
  check(
    'commission_statement_lines_employee_amount',
    sql`${t.kind} <> 'EMPLOYEE' OR ${t.amount} = 0`,
  ),
  check(
    'commission_statement_lines_detail',
    sql`${t.kind} IN ('COMMISSION','CORRECTION') OR
        (${t.lineId} IS NULL AND ${t.sessionId} IS NULL AND ${t.serviceId} IS NULL
          AND ${t.serviceNameAr} IS NULL AND ${t.serviceNameEn} IS NULL
          AND ${t.customerId} IS NULL AND ${t.customerName} IS NULL AND ${t.businessDate} IS NULL)`,
  ),
  check(
    'commission_statement_lines_commission_detail',
    sql`${t.kind} <> 'COMMISSION' OR
        (${t.lineId} IS NOT NULL AND ${t.sessionId} IS NOT NULL
          AND ${t.serviceId} IS NOT NULL AND ${t.businessDate} IS NOT NULL)`,
  ),
  // شهر المصدر موجود بس في الأنواع اللي بتبعد ل شهر تاني: التصحيحات والcarry (D-22).
  check(
    'commission_statement_lines_source_period',
    sql`(${t.sourcePeriod} IS NOT NULL) = (${t.kind} IN ('CORRECTION','CORRECTION_TIP_CARD','CORRECTION_TIP_CASH','CARRY_COMMISSION','CARRY_TIP_CARD'))
        AND (${t.sourcePeriod} IS NULL OR ${periodFormat(t.sourcePeriod)})`,
  ),
];

const lineIndexes = (t: LineSelf) => [
  index('commission_statement_lines_statement_idx').on(t.companyId, t.businessId, t.statementId),
  index('commission_statement_lines_statement_employee_idx').on(
    t.companyId,
    t.statementId,
    t.employeeId,
  ),
  index('commission_statement_lines_employee_idx').on(t.companyId, t.businessId, t.employeeId),
  index('commission_statement_lines_source_branch_idx').on(
    t.companyId,
    t.businessId,
    t.sourceBranchId,
  ),
  index('commission_statement_lines_attached_branches_idx').using('gin', t.attachedBranchIds),
];

export const commissionStatementLines = pgTable(
  'commission_statement_lines',
  commissionStatementLinesColumns,
  (t) => [...lineKeys(t), ...lineRelations(t), ...lineChecks(t), ...lineIndexes(t)],
);

const commissionStatementAttachmentsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  statementId: uuid('statement_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  attachedFrom: date('attached_from').notNull(),
  attachedTo: date('attached_to').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

type AttachmentSelf = BuildExtraConfigColumns<
  string,
  typeof commissionStatementAttachmentsColumns,
  'pg'
>;

const attachmentKeys = (t: AttachmentSelf) => [
  primaryKey({
    name: 'commission_statement_attachments_pkey',
    columns: [t.companyId, t.id],
  }),
  unique('commission_statement_attachments_link_key').on(
    t.companyId,
    t.statementId,
    t.employeeId,
    t.branchId,
    t.attachedFrom,
  ),
];

const attachmentRelations = (t: AttachmentSelf) => [
  foreignKey({
    name: 'commission_statement_attachments_statement_fk',
    columns: [t.companyId, t.businessId, t.statementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    name: 'commission_statement_attachments_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
  foreignKey({
    name: 'commission_statement_attachments_branch_fk',
    columns: [t.companyId, t.businessId, t.branchId],
    foreignColumns: [branches.companyId, branches.businessId, branches.id],
  }),
];

const attachmentChecks = (t: AttachmentSelf) => [
  check('commission_statement_attachments_range', sql`${t.attachedFrom} <= ${t.attachedTo}`),
];

const attachmentIndexes = (t: AttachmentSelf) => [
  index('commission_statement_attachments_statement_idx').on(
    t.companyId,
    t.businessId,
    t.statementId,
  ),
  index('commission_statement_attachments_statement_employee_idx').on(
    t.companyId,
    t.statementId,
    t.employeeId,
  ),
  index('commission_statement_attachments_employee_idx').on(
    t.companyId,
    t.businessId,
    t.employeeId,
  ),
  index('commission_statement_attachments_branch_idx').on(t.companyId, t.businessId, t.branchId),
];

export const commissionStatementAttachments = pgTable(
  'commission_statement_attachments',
  commissionStatementAttachmentsColumns,
  (t) => [
    ...attachmentKeys(t),
    ...attachmentRelations(t),
    ...attachmentChecks(t),
    ...attachmentIndexes(t),
  ],
);
