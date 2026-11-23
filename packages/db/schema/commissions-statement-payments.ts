import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { commissionStatements } from './commissions-statements.ts';
import { employees } from './staff.ts';
import { companies } from './tenancy.ts';

const commissionStatementPaymentsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  statementId: uuid('statement_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  // الصافي الدقيق من الصفوف المجمّدة (قاعدة §9)، وبيفضل زي ما هو مهما كانت طريقة الصرف (D-19).
  exactPayable: numeric('exact_payable', { precision: 14, scale: 3 }).notNull(),
  // المبلغ اللي اتصرف فعلاً: متقرّب لأقرب 5 فلوس لو الكاش، ومساوي للدقيق غير كده (CS-Q12، D-19).
  paidAmount: numeric('paid_amount', { precision: 14, scale: 3 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

type PaymentSelf = BuildExtraConfigColumns<string, typeof commissionStatementPaymentsColumns, 'pg'>;

const paymentKeys = (t: PaymentSelf) => [
  primaryKey({ name: 'commission_statement_payments_pkey', columns: [t.companyId, t.id] }),
  // صف واحد لكل موظفة مجمّدة في الكشف؛ اكتمال المجموعة بيتفحص بتريغر مؤجل على الكشف نفسه.
  unique('commission_statement_payments_employee_key').on(
    t.companyId,
    t.statementId,
    t.employeeId,
  ),
];

const paymentRelations = (t: PaymentSelf) => [
  foreignKey({
    name: 'commission_statement_payments_statement_fk',
    columns: [t.companyId, t.businessId, t.statementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    name: 'commission_statement_payments_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
];

const paymentChecks = (t: PaymentSelf) => [
  // المبلغين بالفلوس وموجبين، ومفيش NaN في numeric؛ مبالغ الصرف عمرها ما تكون سالبة.
  check(
    'commission_statement_payments_amounts',
    sql`${t.exactPayable} >= 0 AND ${t.paidAmount} >= 0
        AND ${t.exactPayable} <> 'NaN'::numeric AND ${t.paidAmount} <> 'NaN'::numeric`,
  ),
];

const paymentIndexes = (t: PaymentSelf) => [
  // فهرس مفتاح الصرف الأجنبي والقارئات اللي بتمشي على (الشركة، النشاط، الكشف).
  index('commission_statement_payments_statement_idx').on(t.companyId, t.businessId, t.statementId),
  index('commission_statement_payments_employee_idx').on(t.companyId, t.businessId, t.employeeId),
];

export const commissionStatementPayments = pgTable(
  'commission_statement_payments',
  commissionStatementPaymentsColumns,
  (t) => [...paymentKeys(t), ...paymentRelations(t), ...paymentChecks(t), ...paymentIndexes(t)],
);
