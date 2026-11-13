import { sql, type BuildExtraConfigColumns } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { packageTypes, services } from './catalog.ts';
import { customers } from './customers.ts';
import { user } from './identity-auth.ts';
import { memberships } from './identity-access.ts';
import { employees } from './staff.ts';
import { branches, companies } from './tenancy.ts';

const xid8 = customType<{ data: string }>({ dataType: () => 'xid8' });
const money = (name: string) => numeric(name, { precision: 14, scale: 3 });

// الاستحقاق: صف واحد لكل باقة مباعة أو مستوردة (spec 058، 42-2).
const packageEntitlementsColumns = {
  companyId: uuid('company_id')
    .notNull()
    .references(() => companies.id),
  id: uuid('id').notNull(),
  businessId: uuid('business_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  /** نوع الباقة: null في الاستيراد لأن المصدر ملف مش الكتالوج (FR-062). */
  packageTypeId: uuid('package_type_id'),
  /** SOLD أو IMPORTED؛ الشكل بتاع كل واحد منهم بيتفحص في قيد الجدول. */
  provenance: text('provenance').notNull(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar'),
  validityDays: integer('validity_days'),
  listPrice: money('list_price'),
  /** المبلغ المدفوع فعلياً؛ مجموع قيم المكوّنات لازم يساويه بالميّ (BR-01). */
  pricePaid: money('price_paid').notNull(),
  discount: money('discount'),
  discountBps: integer('discount_bps'),
  paidMethod: text('paid_method'),
  sellerEmployeeId: uuid('seller_employee_id'),
  sellerLinkedUserId: uuid('seller_linked_user_id'),
  soldBranchId: uuid('sold_branch_id'),
  soldAt: timestamp('sold_at', { withTimezone: true }),
  /** تاريخ البيع المحاسبي: كله بيتبني على يوم النشاط مش على يوم الساعة. */
  soldBusinessDate: date('sold_business_date'),
  soldTimezone: text('sold_timezone'),
  /** late بيعلّم بيع اتسجّل بعد وقوعه وsold_at راجع لتاريخ سابق داخل النافذة المسموحة، زي الزيارة (SA-07، PK-Q11). */
  late: boolean('late').notNull().default(false),
  recordedBy: uuid('recorded_by').notNull(),
  recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
  /** المرجع الخارجي من الملف؛ فريد على مستوى الشركة (FR-066). */
  externalRef: text('external_ref'),
  /** معاينة الاستيراد اللي جاي منها السطر: مفيش FK عشان المعاينة بتتمسح بعد الاستيراد. */
  importBatchId: uuid('import_batch_id'),
  importRow: integer('import_row'),
  expiresOn: date('expires_on').notNull(),
  refundedAmount: money('refunded_amount').notNull().default('0'),
  /** النسخة = 1 + عدد المستردات (BR-03). */
  revision: integer('revision').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** ختم الإنشاء: التريغر بيكتبه وبيستبدل أي قيمة جاية من المستدعي (ADR-0050). */
  createdSystemId: bigint('created_system_id', { mode: 'bigint' }).notNull(),
  createdTxid: xid8('created_txid').notNull(),
  /** ختم آخر تمديد: التريغر يثبت المعاملة والقيمة السابقة حتى لا يُقبل سجل تمديد مستقل عنها. */
  expiresOnChangedSystemId: bigint('expires_on_changed_system_id', { mode: 'bigint' }),
  expiresOnChangedTxid: xid8('expires_on_changed_txid'),
  expiresOnBefore: date('expires_on_before', { mode: 'string' }),
};

type EntitlementSelf = BuildExtraConfigColumns<string, typeof packageEntitlementsColumns, 'pg'>;

const entitlementKeys = (t: EntitlementSelf) => [
  primaryKey({ name: 'package_entitlements_pkey', columns: [t.companyId, t.id] }),
  unique('package_entitlements_business_id_key').on(t.companyId, t.businessId, t.id),
  unique('package_entitlements_external_ref_key').on(t.companyId, t.externalRef),
];

const entitlementRelations = (t: EntitlementSelf) => [
  foreignKey({
    name: 'package_entitlements_customer_fk',
    columns: [t.companyId, t.customerId],
    foreignColumns: [customers.companyId, customers.id],
  }),
  foreignKey({
    name: 'package_entitlements_package_type_fk',
    columns: [t.companyId, t.businessId, t.packageTypeId],
    foreignColumns: [packageTypes.companyId, packageTypes.businessId, packageTypes.id],
  }),
  foreignKey({
    name: 'package_entitlements_seller_employee_fk',
    columns: [t.companyId, t.businessId, t.sellerEmployeeId],
    foreignColumns: [employees.companyId, employees.businessId, employees.id],
  }),
  foreignKey({
    name: 'package_entitlements_seller_user_fk',
    columns: [t.sellerLinkedUserId],
    foreignColumns: [user.id],
  }),
  foreignKey({
    name: 'package_entitlements_sold_branch_fk',
    columns: [t.companyId, t.businessId, t.soldBranchId],
    foreignColumns: [branches.companyId, branches.businessId, branches.id],
  }),
  foreignKey({
    name: 'package_entitlements_recorder_fk',
    columns: [t.recordedBy],
    foreignColumns: [user.id],
  }),
  foreignKey({
    name: 'package_entitlements_recorder_membership_fk',
    columns: [t.companyId, t.recordedBy, t.recordedByMembershipId],
    foreignColumns: [memberships.companyId, memberships.userId, memberships.id],
  }),
];

const entitlementIndexes = (t: EntitlementSelf) => [
  index('package_entitlements_customer_fk_idx').on(t.companyId, t.customerId),
  index('package_entitlements_package_type_fk_idx')
    .on(t.companyId, t.businessId, t.packageTypeId)
    .where(sql`${t.packageTypeId} IS NOT NULL`),
  index('package_entitlements_seller_employee_fk_idx')
    .on(t.companyId, t.businessId, t.sellerEmployeeId)
    .where(sql`${t.sellerEmployeeId} IS NOT NULL`),
  index('package_entitlements_seller_user_fk_idx')
    .on(t.sellerLinkedUserId)
    .where(sql`${t.sellerLinkedUserId} IS NOT NULL`),
  index('package_entitlements_sold_branch_fk_idx')
    .on(t.companyId, t.businessId, t.soldBranchId)
    .where(sql`${t.soldBranchId} IS NOT NULL`),
  index('package_entitlements_recorder_fk_idx').on(t.recordedBy),
  index('package_entitlements_recorder_membership_fk_idx').on(
    t.companyId,
    t.recordedBy,
    t.recordedByMembershipId,
  ),
  // قراءة باقات العميل: ترتيب الانتهاء هو اللي بيحتاجه الاستعلام (FR-070).
  index('package_entitlements_customer_read_idx').on(
    t.companyId,
    t.businessId,
    t.customerId,
    t.expiresOn,
  ),
  uniqueIndex('package_entitlements_import_row_key')
    .on(t.companyId, t.importBatchId, t.importRow)
    .where(sql`${t.importBatchId} IS NOT NULL`),
];

const entitlementChecks = (t: EntitlementSelf) => [
  check('package_entitlements_provenance_check', sql`${t.provenance} IN ('SOLD','IMPORTED')`),
  check(
    'package_entitlements_sold_shape_check',
    sql`${t.provenance} <> 'SOLD' OR (${t.packageTypeId} IS NOT NULL AND ${t.sellerEmployeeId} IS NOT NULL
        AND ${t.paidMethod} IS NOT NULL AND ${t.soldBranchId} IS NOT NULL AND ${t.soldAt} IS NOT NULL
        AND ${t.soldBusinessDate} IS NOT NULL AND ${t.soldTimezone} IS NOT NULL AND ${t.validityDays} IS NOT NULL
        AND ${t.listPrice} IS NOT NULL AND ${t.discount} IS NOT NULL AND ${t.discountBps} IS NOT NULL
        AND ${t.externalRef} IS NULL AND ${t.importBatchId} IS NULL AND ${t.importRow} IS NULL)`,
  ),
  check(
    'package_entitlements_imported_shape_check',
    sql`${t.provenance} <> 'IMPORTED' OR (${t.packageTypeId} IS NULL AND ${t.sellerEmployeeId} IS NULL
        AND ${t.sellerLinkedUserId} IS NULL AND ${t.paidMethod} IS NULL
        AND ${t.soldAt} IS NULL AND ${t.soldBranchId} IS NULL AND ${t.soldTimezone} IS NULL
        AND ${t.soldBusinessDate} IS NULL
        AND ${t.externalRef} IS NOT NULL
        AND ${t.importBatchId} IS NOT NULL AND ${t.importRow} IS NOT NULL AND ${t.importRow} BETWEEN 1 AND 500)`,
  ),
  check('package_entitlements_price_paid_check', sql`${t.pricePaid} BETWEEN 0 AND 99999999999.999`),
  check(
    'package_entitlements_list_price_check',
    sql`${t.listPrice} IS NULL OR ${t.listPrice} BETWEEN 0 AND 99999999999.999`,
  ),
  check(
    'package_entitlements_discount_check',
    sql`${t.discount} IS NULL OR ${t.discount} BETWEEN 0 AND 99999999999.999`,
  ),
  check(
    'package_entitlements_refunded_amount_check',
    sql`${t.refundedAmount} BETWEEN 0 AND 99999999999.999`,
  ),
  check(
    'package_entitlements_discount_bps_check',
    sql`${t.discountBps} IS NULL OR ${t.discountBps} BETWEEN 0 AND 10000`,
  ),
  check(
    'package_entitlements_paid_method_check',
    sql`${t.paidMethod} IS NULL OR ${t.paidMethod} IN ('CASH','CARD')`,
  ),
  check(
    'package_entitlements_external_ref_check',
    sql`${t.externalRef} IS NULL OR char_length(${t.externalRef}) BETWEEN 1 AND 100`,
  ),
];

export const packageEntitlements = pgTable(
  'package_entitlements',
  packageEntitlementsColumns,
  (t) => [
    ...entitlementKeys(t),
    ...entitlementRelations(t),
    ...entitlementIndexes(t),
    ...entitlementChecks(t),
  ],
);

// المكوّن: خدمة واحدة من الباقة، وقيمته = عدد الجلسات × قيمة الجلسة.
export const packageComponents = pgTable(
  'package_components',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    entitlementId: uuid('entitlement_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    /** ترتيب المكوّن كما أدخله المدير، من 1 إلى 20. */
    position: smallint('position').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    /** سعر الخدمة وقت البيع: لقطة مش سعر حيّ. */
    listPriceSnapshot: money('list_price_snapshot').notNull(),
    sessionsTotal: integer('sessions_total').notNull(),
    /** قيمة المكوّن كلها بالدينار؛ مجموع قيم جلساته لازم يساويها (BR-01). */
    componentValue: money('component_value').notNull(),
    /** عمود القفل: صلاحية عمود واحد بس عشان SELECT … FOR UPDATE يقفل الصف، وقيمته دايماً صفر. */
    lockTouch: smallint('lock_touch').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'package_components_pkey', columns: [t.companyId, t.id] }),
    unique('package_components_business_id_key').on(t.companyId, t.businessId, t.id),
    unique('package_components_entitlement_service_key').on(
      t.companyId,
      t.entitlementId,
      t.serviceId,
    ),
    unique('package_components_entitlement_position_key').on(
      t.companyId,
      t.entitlementId,
      t.position,
    ),
    // المفتاح الرابع: هو نفسه هدف المفتاح الأجنبي بتاع الجلسات.
    unique('package_components_entitlement_id_key').on(
      t.companyId,
      t.businessId,
      t.entitlementId,
      t.id,
    ),
    foreignKey({
      name: 'package_components_entitlement_fk',
      columns: [t.companyId, t.businessId, t.entitlementId],
      foreignColumns: [
        packageEntitlements.companyId,
        packageEntitlements.businessId,
        packageEntitlements.id,
      ],
    }),
    foreignKey({
      name: 'package_components_service_fk',
      columns: [t.companyId, t.serviceId, t.businessId],
      foreignColumns: [services.companyId, services.id, services.businessId],
    }),
    index('package_components_entitlement_fk_idx').on(t.companyId, t.businessId, t.entitlementId),
    // الخدمة قبل النشاط تمنع اختيار الفهرس لمسح مكونات النشاط عند البحث بهوية مكوّن بلا إحصاءات.
    index('package_components_service_business_fk_idx').on(t.companyId, t.serviceId, t.businessId),
    check('package_components_position_check', sql`${t.position} BETWEEN 1 AND 20`),
    check('package_components_sessions_total_check', sql`${t.sessionsTotal} BETWEEN 1 AND 365`),
    check(
      'package_components_list_price_check',
      sql`${t.listPriceSnapshot} BETWEEN 0 AND 99999999999.999`,
    ),
    check('package_components_value_check', sql`${t.componentValue} BETWEEN 0 AND 99999999999.999`),
    check('package_components_lock_touch_check', sql`${t.lockTouch} = 0`),
  ],
);

// الجلسة: رصيد واحد قابل للاستهلاك، قيمتها جزء من قيمة المكوّن.
export const packageSessionSlots = pgTable(
  'package_session_slots',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    entitlementId: uuid('entitlement_id').notNull(),
    componentId: uuid('component_id').notNull(),
    /** رقم الجلسة داخل المكوّن: من 1 إلى عدد جلسات المكوّن. */
    ordinal: smallint('ordinal').notNull(),
    /** قيمة الجلسة الواحدة بالدينار. */
    unitValue: money('unit_value').notNull(),
    /** FREE وUSED بينهما انتقال محروس بالاسترداد؛ الاسترجاع المالي يظل مقفولًا حتى 46-1 وIMPORTED_USED نهائية. */
    state: text('state').notNull(),
    /** الاسترداد الحي الذي يحجز الجلسة USED؛ التحرير يمسح المؤشر مع عكس الاسترداد في المعاملة نفسها. */
    currentRedemptionId: uuid('current_redemption_id'),
    // الربط الدائري المؤجل إلى package_redemptions معرّف في SQL الخاص بـ43-1.
  },
  (t) => [
    primaryKey({ name: 'package_session_slots_pkey', columns: [t.companyId, t.id] }),
    unique('package_session_slots_business_id_key').on(t.companyId, t.businessId, t.id),
    unique('package_session_slots_component_ordinal_key').on(t.companyId, t.componentId, t.ordinal),
    index('package_session_slots_redemption_fk_idx').on(t.companyId, t.businessId, t.currentRedemptionId).where(sql`${t.currentRedemptionId} IS NOT NULL`).concurrently(),
    foreignKey({
      name: 'package_session_slots_component_fk',
      columns: [t.companyId, t.businessId, t.entitlementId, t.componentId],
      foreignColumns: [
        packageComponents.companyId,
        packageComponents.businessId,
        packageComponents.entitlementId,
        packageComponents.id,
      ],
    }),
    index('package_session_slots_component_fk_idx').on(
      t.companyId,
      t.businessId,
      t.entitlementId,
      t.componentId,
    ),
    // أول جلسة حرة في المكوّن: ده اللي بتدور عليه شاشة الاسترداد.
    index('package_session_slots_free_idx')
      .on(t.companyId, t.componentId, t.ordinal)
      .where(sql`${t.state} = 'FREE'`),
    check(
      'package_session_slots_state_check',
      sql`${t.state} IN ('FREE','USED','REFUNDED','IMPORTED_USED')`,
    ),
    check(
      'package_session_slots_state_redemption_check',
      sql`(${t.state} = 'USED') = (${t.currentRedemptionId} IS NOT NULL)`,
    ),
    check(
      'package_session_slots_unit_value_check',
      sql`${t.unitValue} BETWEEN 0 AND 99999999999.999`,
    ),
  ],
);

// سجل تمديد الاستحقاق ثابت؛ كل صف يثبت انتقال التاريخ للأمام داخل معاملة واحدة.
export const packageExtensions = pgTable(
  'package_extensions',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    entitlementId: uuid('entitlement_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    previousExpiresOn: date('previous_expires_on', { mode: 'string' }).notNull(),
    newExpiresOn: date('new_expires_on', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    extendedBy: uuid('extended_by').notNull(),
    /** عضوية المدير الفعلية وقت التمديد، مربوطة بالمستخدم نفسه داخل الشركة. */
    extendedByMembershipId: uuid('extended_by_membership_id').notNull(),
    extendedAt: timestamp('extended_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'package_extensions_pkey', columns: [t.companyId, t.id] }),
    unique('package_extensions_business_id_key').on(t.companyId, t.businessId, t.id),
    unique('package_extensions_entitlement_previous_key').on(
      t.companyId,
      t.entitlementId,
      t.previousExpiresOn,
    ),
    foreignKey({
      name: 'package_extensions_entitlement_fk',
      columns: [t.companyId, t.businessId, t.entitlementId],
      foreignColumns: [
        packageEntitlements.companyId,
        packageEntitlements.businessId,
        packageEntitlements.id,
      ],
    }),
    foreignKey({
      name: 'package_extensions_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'package_extensions_extended_by_user_id_fk',
      columns: [t.extendedBy],
      foreignColumns: [user.id],
    }),
    foreignKey({
      name: 'package_extensions_membership_fk',
      columns: [t.companyId, t.extendedBy, t.extendedByMembershipId],
      foreignColumns: [memberships.companyId, memberships.userId, memberships.id],
    }),
    index('package_extensions_branch_fk_idx').on(t.companyId, t.businessId, t.branchId),
    index('package_extensions_extended_by_idx').on(t.extendedBy),
    index('package_extensions_membership_fk_idx').on(
      t.companyId,
      t.extendedBy,
      t.extendedByMembershipId,
    ),
    index('package_extensions_history_idx').on(
      t.companyId,
      t.businessId,
      t.entitlementId,
      t.extendedAt,
    ),
    check(
      'package_extensions_forward_check',
      sql`${t.newExpiresOn} > ${t.previousExpiresOn}`,
    ),
    check(
      'package_extensions_reason_check',
      sql`char_length(${t.reason}) <= 500 AND btrim(${t.reason}, chr(9) || chr(10) || chr(13) || chr(32)) <> ''`,
    ),
  ],
);

// سطر الاسترداد: صف واحد لكل استرداد جلسات من مكوّن واحد. السطر ثابت مالوش تعديل ولا حذف، والعكس سطر جديد.
export const packageRefunds = pgTable(
  'package_refunds',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    entitlementId: uuid('entitlement_id').notNull(),
    componentId: uuid('component_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    /** عدد الجلسات المستردة في السطر ده. */
    sessions: integer('sessions').notNull(),
    /** المبلغ المسترد بالدينار؛ لازم يساوي مجموع قيم الجلسات المستردة. */
    amount: money('amount').notNull(),
    method: text('method').notNull(),
    /** سبب الاسترداد: بيتخزن في السطر بس، مش في تدقيق ولا حدث ولا idempotency. */
    reason: text('reason').notNull(),
    refundedBy: uuid('refunded_by')
      .notNull()
      .references(() => user.id),
    /** عضوية المدير الفعلية وقت الاسترداد، مربوطة بالمستخدم نفسه. */
    refundedByMembershipId: uuid('refunded_by_membership_id').notNull(),
    /** لحظة الاسترداد من ساعة العميل، مش من ساعة السيرفر. */
    refundedAt: timestamp('refunded_at', { withTimezone: true }).notNull(),
    /** نسخة الاستحقاق بعد الاسترداد ده. */
    entitlementRevision: integer('entitlement_revision').notNull(),
  },
  (t) => [
    primaryKey({ name: 'package_refunds_pkey', columns: [t.companyId, t.id] }),
    unique('package_refunds_business_id_key').on(t.companyId, t.businessId, t.id),
    unique('package_refunds_entitlement_revision_key').on(
      t.companyId,
      t.entitlementId,
      t.entitlementRevision,
    ),
    foreignKey({
      name: 'package_refunds_entitlement_fk',
      columns: [t.companyId, t.businessId, t.entitlementId],
      foreignColumns: [
        packageEntitlements.companyId,
        packageEntitlements.businessId,
        packageEntitlements.id,
      ],
    }),
    foreignKey({
      name: 'package_refunds_component_fk',
      columns: [t.companyId, t.businessId, t.entitlementId, t.componentId],
      foreignColumns: [
        packageComponents.companyId,
        packageComponents.businessId,
        packageComponents.entitlementId,
        packageComponents.id,
      ],
    }),
    foreignKey({
      name: 'package_refunds_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    foreignKey({
      name: 'package_refunds_membership_fk',
      columns: [t.companyId, t.refundedBy, t.refundedByMembershipId],
      foreignColumns: [memberships.companyId, memberships.userId, memberships.id],
    }),
    index('package_refunds_entitlement_fk_idx').on(t.companyId, t.businessId, t.entitlementId),
    index('package_refunds_component_fk_idx').on(
      t.companyId,
      t.businessId,
      t.entitlementId,
      t.componentId,
    ),
    index('package_refunds_branch_fk_idx').on(t.companyId, t.businessId, t.branchId),
    index('package_refunds_refunded_by_idx').on(t.refundedBy),
    index('package_refunds_membership_fk_idx').on(
      t.companyId,
      t.refundedBy,
      t.refundedByMembershipId,
    ),
    check('package_refunds_sessions_check', sql`${t.sessions} BETWEEN 1 AND 365`),
    check('package_refunds_amount_check', sql`${t.amount} BETWEEN 0 AND 99999999999.999`),
    check('package_refunds_method_check', sql`${t.method} IN ('CASH','CARD')`),
    check(
      'package_refunds_reason_check',
      sql`char_length(${t.reason}) <= 500 AND btrim(${t.reason}, chr(9) || chr(10) || chr(13) || chr(32)) <> ''`,
    ),
    check('package_refunds_entitlement_revision_check', sql`${t.entitlementRevision} >= 2`),
  ],
);

// سطر لكل جلسة مستردة: الجلسة دي اتستردت مرة واحدة بس في كل الشركة.
export const packageRefundSlots = pgTable(
  'package_refund_slots',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    refundId: uuid('refund_id').notNull(),
    entitlementId: uuid('entitlement_id').notNull(),
    componentId: uuid('component_id').notNull(),
    slotId: uuid('slot_id').notNull(),
    /** ترقيم الجلسة داخل المكوّن: نسخة من ترقيم الجلسة المستردة. */
    ordinal: integer('ordinal').notNull(),
    /** قيمة الجلسة بالدينار: نسخة من قيمة الجلسة المستردة. */
    unitValue: money('unit_value').notNull(),
  },
  (t) => [
    primaryKey({ name: 'package_refund_slots_pkey', columns: [t.companyId, t.id] }),
    unique('package_refund_slots_business_id_key').on(t.companyId, t.businessId, t.id),
    unique('package_refund_slots_slot_key').on(t.companyId, t.slotId),
    foreignKey({
      name: 'package_refund_slots_refund_fk',
      columns: [t.companyId, t.businessId, t.refundId],
      foreignColumns: [packageRefunds.companyId, packageRefunds.businessId, packageRefunds.id],
    }),
    foreignKey({
      name: 'package_refund_slots_component_fk',
      columns: [t.companyId, t.businessId, t.entitlementId, t.componentId],
      foreignColumns: [
        packageComponents.companyId,
        packageComponents.businessId,
        packageComponents.entitlementId,
        packageComponents.id,
      ],
    }),
    foreignKey({
      name: 'package_refund_slots_slot_fk',
      columns: [t.companyId, t.businessId, t.slotId],
      foreignColumns: [
        packageSessionSlots.companyId,
        packageSessionSlots.businessId,
        packageSessionSlots.id,
      ],
    }),
    index('package_refund_slots_refund_fk_idx').on(t.companyId, t.businessId, t.refundId),
    index('package_refund_slots_component_fk_idx').on(
      t.companyId,
      t.businessId,
      t.entitlementId,
      t.componentId,
    ),
    index('package_refund_slots_slot_fk_idx').on(t.companyId, t.businessId, t.slotId),
    check('package_refund_slots_ordinal_check', sql`${t.ordinal} >= 1`),
    check(
      'package_refund_slots_unit_value_check',
      sql`${t.unitValue} BETWEEN 0 AND 99999999999.999`,
    ),
  ],
);
