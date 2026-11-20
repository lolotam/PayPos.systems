import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  char,
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
} from 'drizzle-orm/pg-core';

import { periodFormat } from './commissions-corrections.ts';
import { commissionStatements } from './commissions-statements.ts';
import { employees } from './staff.ts';
import { companies } from './tenancy.ts';

const commissionBlockedCorrectionsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  sourcePeriod: char('source_period', { length: 7 }).notNull(),
  // سبب التوقف: الشهر ما لقاش خطة سارية (NO_PLAN) أو مفيش مرتب (NO_SALARY).
  code: text('code').notNull(),
  // الحدث اللي سجّل التوقف الأول؛ من غير FK زي event_id في التصحيحات.
  firstEventId: uuid('first_event_id').notNull(),
  targetPeriod: char('target_period', { length: 7 }).notNull(),
  // الشهر المحتجز وكشفه اترسّما مرة واحدة عند التسجيل، وما بيتبدلوش أبداً (CM-53b).
  targetStatementId: uuid('target_statement_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  // جيل الخطوة اللي حلّت التوقف؛ بيجي مع resolved_at في زوج واحد.
  resolvedGeneration: integer('resolved_generation'),
};

type BlockedSelf = BuildExtraConfigColumns<
  string,
  typeof commissionBlockedCorrectionsColumns,
  'pg'
>;

const blockedKeys = (t: BlockedSelf) => [
  primaryKey({ name: 'commission_blocked_corrections_pkey', columns: [t.companyId, t.id] }),
  // صف مفتوح واحد لكل موظف في شهر مصدر؛ الصفوف المحلولة ما بتدخلش في القيد الجزئي.
  uniqueIndex('commission_blocked_corrections_open_key')
    .on(t.companyId, t.employeeId, t.sourcePeriod)
    .where(sql`${t.resolvedAt} IS NULL`),
];

const blockedRelations = (t: BlockedSelf) => [
  foreignKey({
    name: 'commission_blocked_corrections_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
  foreignKey({
    name: 'commission_blocked_corrections_target_statement_fk',
    columns: [t.companyId, t.businessId, t.targetPeriod, t.targetStatementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.period,
      commissionStatements.id,
    ],
  }),
];

const blockedChecks = (t: BlockedSelf) => [
  check('commission_blocked_corrections_code', sql`${t.code} IN ('NO_PLAN','NO_SALARY')`),
  check('commission_blocked_corrections_source_period', sql`${periodFormat(t.sourcePeriod)}`),
  check('commission_blocked_corrections_target_period', sql`${periodFormat(t.targetPeriod)}`),
  // الشهر المحتجز بعد شهر المصدر؛ تساويهما أو رجوعه معناه إن الشهر لسه مفتوح.
  check(
    'commission_blocked_corrections_target_after_source',
    sql`${t.targetPeriod} > ${t.sourcePeriod}`,
  ),
  // الحل جاي في زوج: اللحظة وجيلها مع بعض، أو ولا واحدة فيهم.
  check(
    'commission_blocked_corrections_resolution_pair',
    sql`(${t.resolvedAt} IS NULL) = (${t.resolvedGeneration} IS NULL)`,
  ),
  check('commission_blocked_corrections_resolution_generation', sql`${t.resolvedGeneration} > 0`),
];

const blockedIndexes = (t: BlockedSelf) => [
  // فهرس FR-048: الصفوف المفتوحة المعلّقة على كشف هدف واحد، من غير فتح الشهور المحلولة.
  index('commission_blocked_corrections_target_statement_open_idx')
    .on(t.companyId, t.targetStatementId)
    .where(sql`${t.resolvedAt} IS NULL`),
  index('commission_blocked_corrections_list_idx').on(t.companyId, t.businessId, t.createdAt, t.id),
  index('commission_blocked_corrections_employee_idx').on(t.companyId, t.businessId, t.employeeId),
  index('commission_blocked_corrections_target_statement_idx').on(
    t.companyId,
    t.businessId,
    t.targetPeriod,
    t.targetStatementId,
  ),
];

/** تصحيح موقوف لشهر مقفول ما قدروش يسعّروه (ناقص خطة أو مرتب)، والحل بيتأجّل لحد ما يتصلّح. */
export const commissionBlockedCorrections = pgTable(
  'commission_blocked_corrections',
  commissionBlockedCorrectionsColumns,
  (t) => [...blockedKeys(t), ...blockedRelations(t), ...blockedChecks(t), ...blockedIndexes(t)],
);
