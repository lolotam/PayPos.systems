import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { businesses, companies } from './tenancy.ts';

// تقارير سجل إجازات الموظفين الثقيلة المعالجة في الخلفية عبر العامل (D11، PP-176).
const leaveHistoryReportsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  createdBy: uuid('created_by').notNull(),
  /** الاستعلام المعتمد المطلوب للتقرير بصيغة JSONb مجمّدة (D11). */
  query: jsonb('query').notNull(),
  /** بصمة الاستعلام والنطاق للتحقق من عدم التكرار ومنع الازدواج (D10). */
  fingerprint: text('fingerprint').notNull(),
  /** نطاق الفروع وصلاحيات القراءة المجمّدة وقت قبول التقرير (D11). */
  scope: jsonb('scope').notNull(),
  /** اللحظة المرجعية المجمّدة المعتمدة في تقييم سجل الإجازات والشفتات (FR-009). */
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  /** الموعد النهائي لاكتمال المعالجة قبل اعتبار التقرير متعثراً (D12). */
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'),
  /** رمز خطأ المعالجة عند التعثر: LEAVE_HISTORY_REPORT_FAILED أو LEAVE_HISTORY_REPORT_TOO_LARGE. */
  errorCode: text('error_code'),
  /** عدد صفوف التقرير الناتجة بعد اكتمال المعالجة (D11). */
  rowCount: integer('row_count').notNull().default(0),
  /** تاريخ ووقت اكتمال معالجة التقرير وحفظ صفوفه في قاعدة البيانات (D14). */
  computedAt: timestamp('computed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** موعد انتهاء صلاحية التقرير للحذف الدوري التلقائي (D14). */
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
};

type ReportsSelf = BuildExtraConfigColumns<string, typeof leaveHistoryReportsColumns, 'pg'>;

const reportKeys = (t: ReportsSelf) => [
  primaryKey({ name: 'leave_history_reports_pkey', columns: [t.companyId, t.id] }),
];

const reportRelations = (t: ReportsSelf) => [
  foreignKey({
    name: 'leave_history_reports_business_fk',
    columns: [t.companyId, t.businessId],
    foreignColumns: [businesses.companyId, businesses.id],
  }),
  foreignKey({
    name: 'leave_history_reports_creator_fk',
    columns: [t.createdBy],
    foreignColumns: [user.id],
  }),
];

const reportIndexes = (t: ReportsSelf) => [
  index('leave_history_reports_business_fk_idx').on(t.companyId, t.businessId),
  index('leave_history_reports_creator_fk_idx').on(t.createdBy),
  index('leave_history_reports_dedupe_idx').on(
    t.companyId,
    t.businessId,
    t.createdBy,
    t.fingerprint,
    t.deadlineAt,
  ),
  index('leave_history_reports_expiry_idx').on(t.companyId, t.expiresAt),
];

const reportChecks = (t: ReportsSelf) => [
  check('leave_history_reports_status_check', sql`${t.status} IN ('pending', 'ready', 'failed')`),
  check('leave_history_reports_row_count_check', sql`${t.rowCount} BETWEEN 0 AND 25000`),
  check(
    'leave_history_reports_shape_check',
    sql`(${t.status} = 'pending' AND ${t.errorCode} IS NULL AND ${t.computedAt} IS NULL AND ${t.rowCount} = 0)
      OR (${t.status} = 'ready' AND ${t.errorCode} IS NULL AND ${t.computedAt} IS NOT NULL)
      OR (${t.status} = 'failed' AND ${t.errorCode} IS NOT NULL AND ${t.rowCount} = 0)`,
  ),
  check(
    'leave_history_reports_error_code_check',
    sql`${t.errorCode} IS NULL OR ${t.errorCode} IN ('LEAVE_HISTORY_REPORT_FAILED', 'LEAVE_HISTORY_REPORT_TOO_LARGE')`,
  ),
  check('leave_history_reports_fingerprint_check', sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`),
  check(
    'leave_history_reports_json_size_check',
    sql`octet_length(${t.query}::text) <= 8192 AND octet_length(${t.scope}::text) <= 65536`,
  ),
  check('leave_history_reports_deadline_at_check', sql`${t.deadlineAt} > ${t.asOf}`),
  check('leave_history_reports_expires_at_check', sql`${t.expiresAt} > ${t.asOf}`),
];

export const leaveHistoryReports = pgTable(
  'leave_history_reports',
  leaveHistoryReportsColumns,
  (t) => [
    ...reportKeys(t),
    ...reportRelations(t),
    ...reportIndexes(t),
    ...reportChecks(t),
  ],
);

// صفوف نتائج تقرير سجل إجازات الموظفين مرتبة تسلسلياً (D11).
const leaveHistoryReportRowsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  reportId: uuid('report_id').notNull(),
  /** الرقم التسلسلي لترتيب صف التقرير بدءاً من 1 (D11). */
  seq: integer('seq').notNull(),
  /** معرّف الموظف بدون قيد مفتاح أجنبي لضمان عدم تعثر العامل عند حذف الموظف لاحقاً. */
  employeeId: uuid('employee_id').notNull(),
  /** بيانات سجل الإجازة أو الغياب بصيغة JSONb مجمّدة (D11). */
  record: jsonb('record').notNull(),
};

type ReportRowsSelf = BuildExtraConfigColumns<string, typeof leaveHistoryReportRowsColumns, 'pg'>;

const reportRowsKeys = (t: ReportRowsSelf) => [
  primaryKey({
    name: 'leave_history_report_rows_pkey',
    columns: [t.companyId, t.reportId, t.seq],
  }),
];

const reportRowsRelations = (t: ReportRowsSelf) => [
  foreignKey({
    name: 'leave_history_report_rows_report_fk',
    columns: [t.companyId, t.reportId],
    foreignColumns: [leaveHistoryReports.companyId, leaveHistoryReports.id],
  }).onDelete('cascade'),
];

const reportRowsChecks = (t: ReportRowsSelf) => [
  check('leave_history_report_rows_seq_check', sql`${t.seq} >= 1`),
];

export const leaveHistoryReportRows = pgTable(
  'leave_history_report_rows',
  leaveHistoryReportRowsColumns,
  (t) => [
    ...reportRowsKeys(t),
    ...reportRowsRelations(t),
    ...reportRowsChecks(t),
  ],
);
