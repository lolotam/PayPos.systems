import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';
import { commissionStatements } from './commissions-statements.ts';
import { companies } from './tenancy.ts';

const commissionStatementReturnsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  // الكشف المُرجَع: الإرجاع بيحصل على كشف واحد للنشاط، فالمفتاح المركّب بيمنع كشف نشاط تاني.
  statementId: uuid('statement_id').notNull(),
  // صاحب الإرجاع: العضوية اللي رجّعت، مش المستخدم بس، عشان سجل التدقيق يبقى على العضوية.
  returnedBy: uuid('returned_by')
    .notNull()
    .references(() => user.id),
  returnedMembershipId: uuid('returned_membership_id').notNull(),
  // سبب الإرجاع: بيتكتب هنا مرة واحدة وخلاص، وما بيوصلش لحد الإشعار ولا نص التدقيق ولا السجل التشغيلي.
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
};

type ReturnsSelf = BuildExtraConfigColumns<
  string,
  typeof commissionStatementReturnsColumns,
  'pg'
>;

const returnsKeys = (t: ReturnsSelf) => [
  primaryKey({ name: 'commission_statement_returns_pkey', columns: [t.companyId, t.id] }),
];

const returnsRelations = (t: ReturnsSelf) => [
  foreignKey({
    name: 'commission_statement_returns_statement_fk',
    columns: [t.companyId, t.businessId, t.statementId],
    foreignColumns: [
      commissionStatements.companyId,
      commissionStatements.businessId,
      commissionStatements.id,
    ],
  }),
  foreignKey({
    // الراجِع والعضوية لازم يكونوا لنفس الشخص: المفتاح المركّب على (الشركة، اليوزر، العضوية).
    name: 'commission_statement_returns_membership_fk',
    columns: [t.companyId, t.returnedBy, t.returnedMembershipId],
    foreignColumns: [memberships.companyId, memberships.userId, memberships.id],
  }),
];

const returnsChecks = (t: ReturnsSelf) => [
  // السبب مطلوب ومقصوصة (FR-031): الحشو الفاضي أو السبب الطويل مرفوضان في قاعدة البيانات نفسها.
  check('commission_statement_returns_reason', sql`char_length(${t.reason}) BETWEEN 1 AND 500`),
];

const returnsIndexes = (t: ReturnsSelf) => [
  index('commission_statement_returns_statement_idx').on(
    t.companyId,
    t.businessId,
    t.statementId,
  ),
  index('commission_statement_returns_membership_idx').on(
    t.companyId,
    t.returnedBy,
    t.returnedMembershipId,
  ),
  // مفتاح الراجِع المباشر على user (§5): كل مفتاح أجنبي له فهرس، والمفهرس المركّب ما بيغطياش بدايته.
  index('commission_statement_returns_returned_by_idx').on(t.returnedBy),
];

/**
 * إرجاعات كشوف العمولة (FR-031): صف للإضافة فقط بيتكتب وقت الإرجاع في نفس معاملة تغيير الحالة.
 * السبب يعيش هنا وحده، فمفيش سبب في حدث ولا في نص تدقيق ولا في سجل تشغيلي (قاعدة spec 055 D-7).
 */
export const commissionStatementReturns = pgTable(
  'commission_statement_returns',
  commissionStatementReturnsColumns,
  (t) => [
    ...returnsKeys(t),
    ...returnsRelations(t),
    ...returnsChecks(t),
    ...returnsIndexes(t),
  ],
);
