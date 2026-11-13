import { sql, type BuildExtraConfigColumns, type SQLWrapper } from 'drizzle-orm';
import {
  char,
  check,
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

import { commissionStatements } from './commissions-statements.ts';
import { employees } from './staff.ts';
import { branches, companies } from './tenancy.ts';

// نمط الشهر: YYYY-MM بس؛ وسنة 0000 مرفوضة لأن to_date مش بيعرف يحوّلها.
const PERIOD_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$';

const periodFormat = (column: SQLWrapper) =>
  sql`${column} ~ ${sql.raw(`'${PERIOD_PATTERN}'`)} AND substr(${column}, 1, 4) <> '0000'`;

const commissionPeriodGenerationsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  period: char('period', { length: 7 }).notNull(),
  // رقم التوليد: كل تصحيح جديد لنفس (الموظف، الشهر) بياخد رقم أكبر، وسجلات التوليدات القديمة ما بتتغيّرش.
  generation: integer('generation').notNull(),
};

type GenerationsSelf = BuildExtraConfigColumns<
  string,
  typeof commissionPeriodGenerationsColumns,
  'pg'
>;

const generationsKeys = (t: GenerationsSelf) => [
  primaryKey({ name: 'commission_period_generations_pkey', columns: [t.companyId, t.id] }),
  // جيل واحد لكل موظف في الشهر: التكرار معناه تصحيحان بنفس التوليد، وده اللي المفتاح بيمنعه.
  unique('commission_period_generations_employee_period_unique').on(
    t.companyId,
    t.employeeId,
    t.period,
  ),
];

const generationsRelations = (t: GenerationsSelf) => [
  foreignKey({
    name: 'commission_period_generations_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
];

const generationsChecks = (t: GenerationsSelf) => [
  check('commission_period_generations_period', sql`${periodFormat(t.period)}`),
  check('commission_period_generations_generation', sql`${t.generation} > 0`),
];

const generationsIndexes = (t: GenerationsSelf) => [
  index('commission_period_generations_employee_idx')
    .on(t.companyId, t.businessId, t.employeeId)
    .concurrently(),
];

/** جيل التصحيحات لكل موظف في شهر واحد؛ العدّاد هو اللي بيخلي إعادة الحساب تتراكم مش تبدّل. */
export const commissionPeriodGenerations = pgTable(
  'commission_period_generations',
  commissionPeriodGenerationsColumns,
  (t) => [
    ...generationsKeys(t),
    ...generationsRelations(t),
    ...generationsChecks(t),
    ...generationsIndexes(t),
  ],
);

const commissionCorrectionsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  sourcePeriod: char('source_period', { length: 7 }).notNull(),
  targetPeriod: char('target_period', { length: 7 }).notNull(),
  targetStatementId: uuid('target_statement_id').notNull(),
  // مرجع المصدر المجمّد؛ لا يعتمد على بقاء صف المصدر في وحدة أخرى.
  sourceRef: text('source_ref').notNull(),
  kind: text('kind').notNull(),
  // الفرق بإشارته: سالب لما المصدر قلّ، موجب لما زاد.
  amount: numeric('amount', { precision: 14, scale: 3 }).notNull(),
  previousAmount: numeric('previous_amount', { precision: 14, scale: 3 }).notNull(),
  newAmount: numeric('new_amount', { precision: 14, scale: 3 }).notNull(),
  generation: integer('generation').notNull(),
  // أثر التصحيح على الحدث اللي سبّبه.
  eventId: uuid('event_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sourceBranchId: uuid('source_branch_id'),
  sourceBusinessDate: date('source_business_date'),
  // الفروع اللي كانت الموظفة مربوطة بيها يوم عمل المصدر؛ فاضية لما مفيش ارتباط مجمّد.
  attachedBranchIds: uuid('attached_branch_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
};

type CorrectionsSelf = BuildExtraConfigColumns<string, typeof commissionCorrectionsColumns, 'pg'>;

const correctionsKeys = (t: CorrectionsSelf) => [
  primaryKey({ name: 'commission_corrections_pkey', columns: [t.companyId, t.id] }),
  // مفتاح منع التكرار: نفس المصدر لنفس الموظف في نفس التوليد يتكتب مرة واحدة بس.
  unique('commission_corrections_source_key').on(
    t.companyId,
    t.sourcePeriod,
    t.employeeId,
    t.sourceRef,
    t.generation,
  ),
];

const correctionsRelations = (t: CorrectionsSelf) => [
  foreignKey({
    name: 'commission_corrections_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
  foreignKey({
    // الشهر الهدف والكشف الهدف حقيقة واحدة: المفتاح المركّب بيضمن إن الشهر من نفس النشاط.
    name: 'commission_corrections_target_statement_fk',
    columns: [t.companyId, t.businessId, t.targetPeriod, t.targetStatementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.period,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    name: 'commission_corrections_source_branch_fk',
    columns: [t.companyId, t.businessId, t.sourceBranchId],
    foreignColumns: [branches.companyId, branches.businessId, branches.id],
  }),
];

const correctionsChecks = (t: CorrectionsSelf) => [
  check(
    'commission_corrections_kind',
    sql`${t.kind} IN ('COMMISSION','SALE','TIP_CARD','TIP_CASH')`,
  ),
  check('commission_corrections_amount', sql`${t.amount} = ${t.newAmount} - ${t.previousAmount}`),
  check('commission_corrections_generation', sql`${t.generation} > 0`),
  check('commission_corrections_source_period', sql`${periodFormat(t.sourcePeriod)}`),
  check('commission_corrections_target_period', sql`${periodFormat(t.targetPeriod)}`),
  // التصحيح بينزل في شهر بعد شهر المصدر؛ التصحيح في نفس الشهر أو قبله معناه إن الشهر لسه مفتوح.
  check('commission_corrections_target_after_source', sql`${t.targetPeriod} > ${t.sourcePeriod}`),
];

const correctionsIndexes = (t: CorrectionsSelf) => [
  index('commission_corrections_target_period_idx')
    .on(t.companyId, t.businessId, t.targetPeriod)
    .concurrently(),
  index('commission_corrections_target_statement_idx')
    .on(t.companyId, t.businessId, t.targetPeriod, t.targetStatementId)
    .concurrently(),
  index('commission_corrections_employee_idx')
    .on(t.companyId, t.businessId, t.employeeId)
    .concurrently(),
  index('commission_corrections_source_branch_idx')
    .on(t.companyId, t.businessId, t.sourceBranchId)
    .concurrently(),
  index('commission_corrections_attached_branches_idx')
    .using('gin', t.attachedBranchIds)
    .concurrently(),
];

/** صف تصحيح واحد: الفرق بين المبلغ المجمّد والمبلغ الجديد، في الشهر الهدف اللي استقبله. */
export const commissionCorrections = pgTable(
  'commission_corrections',
  commissionCorrectionsColumns,
  (t) => [
    ...correctionsKeys(t),
    ...correctionsRelations(t),
    ...correctionsChecks(t),
    ...correctionsIndexes(t),
  ],
);
