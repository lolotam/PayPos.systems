import { sql, type BuildExtraConfigColumns, type SQLWrapper } from 'drizzle-orm';
import {
  char,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { commissionStatements } from './commissions-statements.ts';
import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';
import { businesses, companies } from './tenancy.ts';

// نفس نمط الشهر بتاع كشف العمولة: YYYY-MM بس، وسنة 0000 مرفوضة لأن to_date مش بيعرف يحوّلها.
// النمط متكرر هنا عن قصد: كشف العمولة ما بيصدّرش الـ helper، والنسختين لازم تفضلا متطابقتين.
const PERIOD_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$';

const periodFormat = (column: SQLWrapper) =>
  sql`${column} ~ ${sql.raw(`'${PERIOD_PATTERN}'`)} AND substr(${column}, 1, 4) <> '0000'`;

const commissionStatementExportsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  // معرّف الصف نفسه؛ مش معرّف الـ render، عشان كل طلب بياخد معرّفه.
  id: uuid('id').notNull(),
  // معرّف الـ render بتاع ADR-0049؛ هو اللي بيربط طلب التصدير بمهمة الرندر.
  renderId: uuid('render_id').notNull(),
  businessId: uuid('business_id').notNull(),
  statementId: uuid('statement_id').notNull(),
  period: char('period', { length: 7 }).notNull(),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => user.id),
  requestedMembershipId: uuid('requested_membership_id').notNull(),
  // مدى الطلب وقت ما اتطلب: كل النشاط، أو الفروع اللي القارئ معاه حقها.
  scope: text('scope').notNull(),
  // فروع القارئ وقت الطلب؛ لقطة وقت الطلب مش لقطة حيّة، عشان ما يتغيّرش بتغيّر الصلاحيات.
  branchIds: uuid('branch_ids').array(),
  // الموظفون من الصفوف المجمّدة اللي فروعهم بتقاطع فروع القارئ.
  employeeIds: uuid('employee_ids').array(),
  language: text('language').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
  collectedAt: timestamp('collected_at', { withTimezone: true }),
};

type ExportSelf = BuildExtraConfigColumns<string, typeof commissionStatementExportsColumns, 'pg'>;

const exportKeys = (t: ExportSelf) => [
  primaryKey({
    name: 'commission_statement_exports_pkey',
    columns: [t.companyId, t.id],
  }),
  unique('commission_statement_exports_render_key').on(t.companyId, t.renderId),
];

const exportRelations = (t: ExportSelf) => [
  foreignKey({
    // الربط بالتحديد: نفس الشركة والنشاط والشهر، عشان التصدير ما ينفعش يقرا شهر تاني.
    name: 'commission_statement_exports_statement_fk',
    columns: [t.companyId, t.businessId, t.period, t.statementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.period,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    name: 'commission_statement_exports_business_fk',
    columns: [t.companyId, t.businessId],
    foreignColumns: [businesses.companyId, businesses.id],
  }),
  foreignKey({
    // الطلب لازم يكون من عضو في نفس الشركة؛ المفتاح المركّب بيمنع طلب حد من شركة تانية.
    name: 'commission_statement_exports_membership_fk',
    columns: [t.companyId, t.requestedBy, t.requestedMembershipId],
    foreignColumns: [memberships.companyId, memberships.userId, memberships.id],
  }),
];

const exportChecks = (t: ExportSelf) => [
  check('commission_statement_exports_period', sql`${periodFormat(t.period)}`),
  check('commission_statement_exports_scope', sql`${t.scope} IN ('BUSINESS','BRANCHES')`),
  check('commission_statement_exports_language', sql`${t.language} IN ('ar','en')`),
  check(
    'commission_statement_exports_scope_arrays',
    sql`(${t.scope} = 'BUSINESS' AND ${t.branchIds} IS NULL AND ${t.employeeIds} IS NULL)
        OR (${t.scope} = 'BRANCHES' AND ${t.branchIds} IS NOT NULL AND ${t.employeeIds} IS NOT NULL
          AND cardinality(${t.branchIds}) > 0)`,
  ),
  check(
    'commission_statement_exports_branch_ids_elements',
    sql`array_position(${t.branchIds}, NULL::uuid) IS NULL`,
  ),
  check(
    'commission_statement_exports_employee_ids_elements',
    sql`array_position(${t.employeeIds}, NULL::uuid) IS NULL`,
  ),
];

const exportIndexes = (t: ExportSelf) => [
  index('commission_statement_exports_statement_idx').on(
    t.companyId,
    t.businessId,
    t.period,
    t.statementId,
  ),
  index('commission_statement_exports_requester_idx').on(t.companyId, t.requestedBy, t.requestedAt),
  index('commission_statement_exports_membership_idx').on(
    t.companyId,
    t.requestedBy,
    t.requestedMembershipId,
  ),
  index('commission_statement_exports_requested_by_idx').on(t.requestedBy),
];

export const commissionStatementExports = pgTable(
  'commission_statement_exports',
  commissionStatementExportsColumns,
  (t) => [...exportKeys(t), ...exportRelations(t), ...exportChecks(t), ...exportIndexes(t)],
);
