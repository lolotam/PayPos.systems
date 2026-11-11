import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';
import { packageEntitlements } from './orders-packages.ts';
import { branches, businesses, companies } from './tenancy.ts';

const money = (name: string) => numeric(name, { precision: 14, scale: 3 });

// طلبات بيع الباقات المقبولة بانتظار تنفيذ العامل (PP-170، 42-3b1).
const packageSaleRequestsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  branchId: uuid('branch_id').notNull(),
  recordedBy: uuid('recorded_by').notNull(),
  /** عضوية مسجل البيع للتحقق من الصلاحيات وسياق الفرع (FR-018). */
  recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
  /** الحد الأقصى للخصم المسموح به للمسجل بالـ bps؛ null يعني غير محدود (FR-013). */
  discountLimitBps: integer('discount_limit_bps'),
  /** العميلة المشترية؛ بدون FK لرفض المجهولة داخل العامل بدلاً من خطأ قاعدة بيانات (SA-08). */
  customerId: uuid('customer_id').notNull(),
  /** نوع الباقة المطلوب؛ بدون FK ليعالجه العامل كرفض منطقي (SA-08). */
  packageTypeId: uuid('package_type_id').notNull(),
  /** نسخة نوع الباقة المعروضة على الشاشة لمنع بيع تعريف تغيّر (FR-018b). */
  expectedTypeRevision: integer('expected_type_revision').notNull(),
  /** مصفوفة نسخ وأسعار الخدمات وقت العرض للتحقق من ثبات التسعير (FR-018c). */
  expectedServiceRevisions: jsonb('expected_service_revisions').notNull(),
  /** المبلغ المدفوع فعلاً بالدينار بثلاث خانات عشرية، ويُقرأ في TS كـ bigint بالفلس (FR-018). */
  pricePaid: money('price_paid').notNull(),
  /** طريقة الدفع: CASH أو CARD فقط (FR-015). */
  paidMethod: text('paid_method').notNull(),
  /** الموظفة البائعة؛ بدون FK لرفض غير المؤهلة داخل العامل (SA-05). */
  sellerEmployeeId: uuid('seller_employee_id').notNull(),
  /** تاريخ ووقت البيع الفعلي إذا كان بأثر رجعي داخل النافذة المسموحة (FR-016). */
  soldAt: timestamp('sold_at', { withTimezone: true }),
  /** لحظة تسجيل الطلب وقبوله في الـ API للاعتماد عليها في كل حسابات الوقت (FR-018). */
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  /** حالة الطلب: pending أو completed أو failed (FR-018). */
  status: text('status').notNull().default('pending'),
  /** معرّف استحقاق الباقة الناتج عند اكتمال البيع بنجاح (FR-018). */
  entitlementId: uuid('entitlement_id'),
  /** رمز الخطأ عند فشل تنفيذ البيع في العامل (FR-018). */
  errorCode: text('error_code'),
  /** تفاصيل إضافية عن سبب الرفض مثل النسخة الحالية لخدمة أو نوع (FR-018). */
  errorDetails: jsonb('error_details'),
  /** لحظة انتهاء معالجة الطلب سواء بالنجاح أو الفشل (FR-018). */
  finishedAt: timestamp('finished_at', { withTimezone: true }),
};

type SaleRequestsSelf = BuildExtraConfigColumns<string, typeof packageSaleRequestsColumns, 'pg'>;

const saleRequestKeys = (t: SaleRequestsSelf) => [
  primaryKey({ name: 'package_sale_requests_pkey', columns: [t.companyId, t.id] }),
];

const saleRequestRelations = (t: SaleRequestsSelf) => [
  foreignKey({
    name: 'package_sale_requests_business_fk',
    columns: [t.companyId, t.businessId],
    foreignColumns: [businesses.companyId, businesses.id],
  }),
  foreignKey({
    name: 'package_sale_requests_branch_fk',
    columns: [t.companyId, t.businessId, t.branchId],
    foreignColumns: [branches.companyId, branches.businessId, branches.id],
  }),
  foreignKey({
    name: 'package_sale_requests_recorder_fk',
    columns: [t.recordedBy],
    foreignColumns: [user.id],
  }),
  foreignKey({
    name: 'package_sale_requests_recorder_membership_fk',
    columns: [t.companyId, t.recordedBy, t.recordedByMembershipId],
    foreignColumns: [memberships.companyId, memberships.userId, memberships.id],
  }),
  foreignKey({
    name: 'package_sale_requests_entitlement_fk',
    columns: [t.companyId, t.entitlementId],
    foreignColumns: [packageEntitlements.companyId, packageEntitlements.id],
  }).onDelete('restrict'),
];

const saleRequestIndexes = (t: SaleRequestsSelf) => [
  index('package_sale_requests_business_fk_idx').on(t.companyId, t.businessId),
  index('package_sale_requests_branch_fk_idx').on(t.companyId, t.businessId, t.branchId),
  index('package_sale_requests_recorder_fk_idx').on(t.recordedBy),
  index('package_sale_requests_recorder_membership_fk_idx').on(
    t.companyId,
    t.recordedBy,
    t.recordedByMembershipId,
  ),
  index('package_sale_requests_entitlement_fk_idx')
    .on(t.companyId, t.entitlementId)
    .where(sql`${t.entitlementId} IS NOT NULL`),
  // قراءة منشئ الطلب لمعرفة حالة البيع المعلق (SA-09b).
  index('package_sale_requests_creator_status_idx').on(t.companyId, t.recordedBy, t.id),
  // مهمة دورية لمسح الطلبات العالقة بعد 10 دقائق (FR-018).
  index('package_sale_requests_recovery_sweep_idx').on(t.companyId, t.status, t.recordedAt),
];

const saleRequestChecks = (t: SaleRequestsSelf) => [
  check('package_sale_requests_status_check', sql`${t.status} IN ('pending', 'completed', 'failed')`),
  check('package_sale_requests_paid_method_check', sql`${t.paidMethod} IN ('CASH', 'CARD')`),
  check(
    'package_sale_requests_discount_limit_bps_check',
    sql`${t.discountLimitBps} IS NULL OR ${t.discountLimitBps} BETWEEN 0 AND 10000`,
  ),
  check(
    'package_sale_requests_expected_service_revisions_check',
    sql`CASE WHEN jsonb_typeof(${t.expectedServiceRevisions}) = 'array' THEN jsonb_array_length(${t.expectedServiceRevisions}) BETWEEN 1 AND 20 ELSE false END`,
  ),
  check(
    'package_sale_requests_error_details_size_check',
    sql`${t.errorDetails} IS NULL OR octet_length(${t.errorDetails}::text) <= 8192`,
  ),
  check(
    'package_sale_requests_state_shape_check',
    sql`(${t.status} = 'pending' AND ${t.entitlementId} IS NULL AND ${t.errorCode} IS NULL AND ${t.errorDetails} IS NULL AND ${t.finishedAt} IS NULL)
      OR (${t.status} = 'completed' AND ${t.entitlementId} IS NOT NULL AND ${t.finishedAt} IS NOT NULL AND ${t.errorCode} IS NULL AND ${t.errorDetails} IS NULL)
      OR (${t.status} = 'failed' AND ${t.errorCode} IS NOT NULL AND ${t.finishedAt} IS NOT NULL AND ${t.entitlementId} IS NULL)`,
  ),
  check('package_sale_requests_price_paid_check', sql`${t.pricePaid} BETWEEN 0 AND 99999999999.999`),
];

export const packageSaleRequests = pgTable(
  'package_sale_requests',
  packageSaleRequestsColumns,
  (t) => [
    ...saleRequestKeys(t),
    ...saleRequestRelations(t),
    ...saleRequestIndexes(t),
    ...saleRequestChecks(t),
  ],
);
