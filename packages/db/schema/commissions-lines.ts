import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  boolean,
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
  uuid,
} from 'drizzle-orm/pg-core';

import { services } from './catalog.ts';
import { customers } from './customers.ts';
import { employees } from './staff.ts';
import { branches, businesses, companies } from './tenancy.ts';

/** رأس لقطة بند الخدمة: هوية الزيارة ومراجعها ومراجعتها وشهرها المحاسبي. */
export const commissionLineHeads = pgTable(
  'commission_line_heads',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    businessId: uuid('business_id').notNull(),
    lineId: uuid('line_id').notNull(),
    // هوية الجلسة لقطة من الحدث بلا FK لجدول orders، حتى لا يقرأ commissions ملك orders.
    sessionId: uuid('session_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    businessDate: date('business_date').notNull(),
    period: text('period').notNull(),
  },
  (t) => [
    primaryKey({ name: 'commission_line_heads_pkey', columns: [t.companyId, t.lineId] }),
    foreignKey({
      name: 'commission_line_heads_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'commission_line_heads_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'commission_line_heads_service_fk',
      columns: [t.companyId, t.businessId, t.serviceId],
      foreignColumns: [services.companyId, services.businessId, services.id],
    }),
    foreignKey({
      name: 'commission_line_heads_customer_fk',
      columns: [t.companyId, t.customerId],
      foreignColumns: [customers.companyId, customers.id],
    }),
    check('commission_line_heads_revision_positive', sql`${t.revision} > 0`),
    check('commission_line_heads_status', sql`${t.status} IN ('ACTIVE','CANCELLED')`),
    check(
      'commission_line_heads_period_format',
      sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      'commission_line_heads_period_business_date',
      sql`${t.period} = to_char(${t.businessDate}, 'YYYY-MM')`,
    ),
    index('commission_line_heads_branch_idx').on(t.companyId, t.businessId, t.branchId),
    index('commission_line_heads_service_idx').on(t.companyId, t.businessId, t.serviceId),
    index('commission_line_heads_customer_idx').on(t.companyId, t.customerId),
  ],
);

const commissionLinesColumns = {
  companyId: uuid('company_id').notNull(),
  businessId: uuid('business_id').notNull(),
  lineId: uuid('line_id').notNull(),
  // الفرع والخدمة نسختان من حدث الرأس نفسه، ولكل منهما FK مركّب على النشاط حتى لا يقبل
  // الإسقاط فرعاً أو خدمة من نشاط آخر.
  branchId: uuid('branch_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  serviceId: uuid('service_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  businessDate: date('business_date').notNull(),
  period: text('period').notNull(),
  net: numeric('net', { precision: 14, scale: 3 }).notNull(),
  netShare: numeric('net_share', { precision: 14, scale: 3 }).notNull(),
  shareBps: integer('share_bps').notNull(),
  ruleKind: text('rule_kind').notNull(),
  rulePctBps: integer('rule_pct_bps'),
  ruleFixedAmount: numeric('rule_fixed_amount', { precision: 14, scale: 3 }),
  counts: boolean('counts').notNull(),
  status: text('status').notNull(),
};

type LinesSelf = BuildExtraConfigColumns<string, typeof commissionLinesColumns, 'pg'>;

const linesKeys = (t: LinesSelf) => [
  primaryKey({
    name: 'commission_lines_pkey',
    columns: [t.companyId, t.lineId, t.employeeId],
  }),
];

const linesRelations = (t: LinesSelf) => [
  foreignKey({
    name: 'commission_lines_head_fk',
    columns: [t.companyId, t.lineId],
    foreignColumns: [commissionLineHeads.companyId, commissionLineHeads.lineId],
  }),
  foreignKey({
    name: 'commission_lines_employee_fk',
    columns: [t.companyId, t.businessId, t.employeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
  foreignKey({
    name: 'commission_lines_business_fk',
    columns: [t.companyId, t.businessId],
    foreignColumns: [businesses.companyId, businesses.id],
  }),
  foreignKey({
    name: 'commission_lines_branch_fk',
    columns: [t.companyId, t.businessId, t.branchId],
    foreignColumns: [branches.companyId, branches.businessId, branches.id],
  }),
  foreignKey({
    name: 'commission_lines_service_fk',
    columns: [t.companyId, t.businessId, t.serviceId],
    foreignColumns: [services.companyId, services.businessId, services.id],
  }),
];

const linesChecks = (t: LinesSelf) => [
  check(
    'commission_lines_period_format',
    sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
  ),
  check(
    'commission_lines_period_business_date',
    sql`${t.period} = to_char(${t.businessDate}, 'YYYY-MM')`,
  ),
  check(
    'commission_lines_net_nonnegative',
    sql`${t.net} BETWEEN 0 AND 99999999999.999`,
  ),
  check(
    'commission_lines_net_share_nonnegative',
    sql`${t.netShare} BETWEEN 0 AND 99999999999.999`,
  ),
  check('commission_lines_net_share_within_net', sql`${t.netShare} <= ${t.net}`),
  check('commission_lines_share_bps_bounds', sql`${t.shareBps} BETWEEN 1 AND 10000`),
  check('commission_lines_rule_kind', sql`${t.ruleKind} IN ('FOLLOW_PLAN','ZERO','PCT','FIXED')`),
  check(
    'commission_lines_rule_pct_present',
    sql`(${t.ruleKind} = 'PCT') = (${t.rulePctBps} IS NOT NULL)`,
  ),
  check(
    'commission_lines_rule_pct_bounds',
    sql`${t.rulePctBps} IS NULL OR ${t.rulePctBps} BETWEEN 0 AND 10000`,
  ),
  check(
    'commission_lines_rule_fixed_present',
    sql`(${t.ruleKind} = 'FIXED') = (${t.ruleFixedAmount} IS NOT NULL)`,
  ),
  check(
    'commission_lines_rule_fixed_nonnegative',
    sql`${t.ruleFixedAmount} IS NULL OR ${t.ruleFixedAmount} BETWEEN 0 AND 99999999999.999`,
  ),
  check('commission_lines_status', sql`${t.status} IN ('ACTIVE','CANCELLED')`),
];

const linesIndexes = (t: LinesSelf) => [
  index('commission_lines_period_employee_idx').on(
    t.companyId,
    t.businessId,
    t.period,
    t.employeeId,
  ),
  index('commission_lines_employee_idx').on(t.companyId, t.businessId, t.employeeId),
  index('commission_lines_branch_idx').on(t.companyId, t.businessId, t.branchId),
  index('commission_lines_service_idx').on(t.companyId, t.businessId, t.serviceId),
];

/** صف نصيب كل منفّذة من البند؛ يُستبدل كله عند وصول مراجعة أحدث. */
export const commissionLines = pgTable(
  'commission_lines',
  commissionLinesColumns,
  (t) => [...linesKeys(t), ...linesRelations(t), ...linesChecks(t), ...linesIndexes(t)],
);
