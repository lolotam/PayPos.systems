import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { employees } from './staff.ts';
import { branches, businesses } from './tenancy.ts';

/**
 * بيع باقة واحد لكل شركة كما يراه إسقاط العمولة: المراجعة الأحدث تستبدل الصف،
 * وهوية البيع من الحدث دون ربط بجدول تملكه orders زي commission_tip_heads.session_id.
 */
export const commissionSales = pgTable(
  'commission_sales',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    /** بائع الباقة: nullable كما في مخطط spec 059، والعقد يجعل الحدث يكتبه دائماً. */
    sellerEmployeeId: uuid('seller_employee_id'),
    /** يوم عمل البيع يأتي من الحدث (FR-018)، ولا يُشتق مرة أخرى من sold_at. */
    businessDate: date('business_date').notNull(),
    period: text('period').notNull(),
    pricePaid: numeric('price_paid', { precision: 14, scale: 3 }).notNull(),
    /** إجمالي المرتجعات التراكمي بعد آخر مرتجع، لا يتجاوز المدفوع. */
    refundedAmount: numeric('refunded_amount', { precision: 14, scale: 3 }).notNull(),
    /** قيمة الحدث كما هي ('SOLD' اليوم)؛ التحويل لحالة المحرك بيد القارئ في 50-5 و55-1d. */
    status: text('status').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.id] }),
    unique('commission_sales_sale_unique').on(t.companyId, t.saleId),
    foreignKey({
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      columns: [t.companyId, t.businessId, t.sellerEmployeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    check('commission_sales_revision_positive', sql`${t.revision} > 0`),
    check('commission_sales_period_format', sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'commission_sales_period_date',
      sql`${t.period} = to_char(${t.businessDate}, 'YYYY-MM')`,
    ),
    check('commission_sales_price_paid', sql`${t.pricePaid} BETWEEN 0 AND 99999999999.999`),
    check(
      'commission_sales_refunded_amount',
      sql`${t.refundedAmount} BETWEEN 0 AND ${t.pricePaid}`,
    ),
    check('commission_sales_status', sql`${t.status} IN ('SOLD')`),
    index('commission_sales_branch_idx')
      .on(t.companyId, t.businessId, t.branchId)
      .concurrently(),
    index('commission_sales_seller_period_idx')
      .on(t.companyId, t.businessId, t.sellerEmployeeId, t.period)
      .concurrently(),
  ],
);
