import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  char,
  check,
  foreignKey,
  index,
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
import { companies } from './tenancy.ts';

const commissionCarriesColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  // COMMISSION رصيد العمولة، وTIP_CARD رصيد بقشيش الكارت؛ النوعان ما بيتقاصّوش (BR-06، D-22).
  kind: text('kind').notNull(),
  // الرصيد السالب كله كما هو؛ الشهر المصدر بيدفع صفر والباقي بيترحّل لأول شهر مفتوح بعده.
  amount: numeric('amount', { precision: 14, scale: 3 }).notNull(),
  sourceStatementId: uuid('source_statement_id').notNull(),
  sourcePeriod: char('source_period', { length: 7 }).notNull(),
  targetPeriod: char('target_period', { length: 7 }).notNull(),
  // كشف الهدف اتحدد مرة واحدة وقت الاعتماد بنفس اختيار التصحيحات (D-13)، وما بيتبدلش.
  targetStatementId: uuid('target_statement_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

type CarriesSelf = BuildExtraConfigColumns<string, typeof commissionCarriesColumns, 'pg'>;

const carriesKeys = (t: CarriesSelf) => [
  primaryKey({ name: 'commission_carries_pkey', columns: [t.companyId, t.id] }),
  // مرحّل واحد لكل نوع وموظفة في الكشف المصدر: اعتماد الشهر بيكتبه مرة واحدة (D-22).
  unique('commission_carries_source_key').on(
    t.companyId,
    t.sourceStatementId,
    t.employeeId,
    t.kind,
  ),
];

const carriesRelations = (t: CarriesSelf) => [
  foreignKey({
    name: 'commission_carries_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
  // الكشفين تبع نفس النشاط وشهريهما المسجّلين: المفتاح المركّب بيمنع كشف نشاط تاني أو شهر غلط.
  foreignKey({
    name: 'commission_carries_source_statement_fk',
    columns: [t.companyId, t.businessId, t.sourcePeriod, t.sourceStatementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.period,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    name: 'commission_carries_target_statement_fk',
    columns: [t.companyId, t.businessId, t.targetPeriod, t.targetStatementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.period,
      commissionStatements.id,
    ],
  }),
];

const carriesChecks = (t: CarriesSelf) => [
  // الرصيد المرحّل سالب دايماً؛ الموجب بيتدفع والصفر ما بيترحّلش.
  check('commission_carries_amount', sql`${t.amount} < 0`),
  check('commission_carries_target_after_source', sql`${t.targetPeriod} > ${t.sourcePeriod}`),
];

const carriesIndexes = (t: CarriesSelf) => [
  // فهرس مفتاح الموظفة، وفهرسا مفتاحي الكشفين بنفس أعمدتهم بالظبط؛ الأخير بيخدم قراءة مرحّلات كشف الهدف.
  index('commission_carries_employee_idx').on(t.companyId, t.businessId, t.employeeId),
  index('commission_carries_source_statement_idx').on(
    t.companyId,
    t.businessId,
    t.sourcePeriod,
    t.sourceStatementId,
  ),
  index('commission_carries_target_statement_idx').on(
    t.companyId,
    t.businessId,
    t.targetPeriod,
    t.targetStatementId,
  ),
];

/**
 * دفتر المرحّلات (D-22): رصيد سالب بيتكتب مرة واحدة عند اعتماد الشهر المصدر ويتقرا في تقدير
 * كشف الهدف وبصمته وتجميده. للإضافة فقط، ومالوش فرع لأنه رصيد الموظفة كله.
 */
export const commissionCarries = pgTable('commission_carries', commissionCarriesColumns, (t) => [
  ...carriesKeys(t),
  ...carriesRelations(t),
  ...carriesChecks(t),
  ...carriesIndexes(t),
]);
