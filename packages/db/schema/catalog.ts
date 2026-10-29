import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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

import { branches, businesses, companies } from './tenancy.ts';

// خدمات النشاط: الاسم والسعر وقاعدة العمولة وراية احتسابها في المجمّع.
// الـ RLS والـ FORCE والـ grants في migration مكتوبة بإيد (drizzle-kit مبيعرفش FORCE ROW LEVEL SECURITY).
// قاعدة العمولة متخزنة أعمدة متسقة مش رقم JSON: نسبة bps عدد صحيح، والمبلغ الثابت numeric(14,3)،
// عشان "المال مبيبقاش number" يفضل صحيح والقاعدة المشوّهة مستحيل توجد.
export const services = pgTable(
  'services',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    // السعر بالدينار الكويتي بـ 3 خانات عشرية؛ مش رقم عشري في TS أبداً.
    price: numeric('price', { precision: 14, scale: 3 }).notNull(),
    /** FOLLOW_PLAN | ZERO | PCT | FIXED — القيمة المرافقة في العمود المطابق فقط. */
    commissionRuleKind: text('commission_rule_kind').notNull(),
    // نسبة أساس نقط (0–10000)؛ مش وحدات Percentage (0–100 بمقياس).
    commissionPctBps: integer('commission_pct_bps'),
    // مبلغ ثابت بالفلس؛ الفارق عن سعر الخدمة إنه كسب للموظفة مش تحصيل.
    commissionFixedAmount: numeric('commission_fixed_amount', { precision: 14, scale: 3 }),
    // افتراضي إن الخدمة بتتقدّم مجمّع الشرائح؛ المالك يقدر يستثنيها.
    countsTowardThreshold: boolean('counts_toward_threshold').notNull().default(true),
    // عداد تعديل يمنع مديرين من الكتابة فوق نفس النسخة (زي employees).
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'services_pkey', columns: [t.companyId, t.id] }),
    // الـ unique ده هو نفسه فهرس قائمة النشاط وصفحاته (company_id, business_id, id)؛ فهرس تاني بنفس الأعمدة كان تكرار.
    unique('services_company_business_id_key').on(t.companyId, t.businessId, t.id),
    foreignKey({
      name: 'services_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    check('services_name_en_length', sql`char_length(trim(${t.nameEn})) BETWEEN 1 AND 255`),
    check(
      'services_name_ar_length',
      sql`${t.nameAr} IS NULL OR char_length(trim(${t.nameAr})) BETWEEN 1 AND 255`,
    ),
    check('services_price_nonnegative', sql`${t.price} BETWEEN 0 AND 99999999999.999`),
    check(
      'services_rule_kind',
      sql`${t.commissionRuleKind} IN ('FOLLOW_PLAN','ZERO','PCT','FIXED')`,
    ),
    check(
      'services_rule_pct_present',
      sql`(${t.commissionRuleKind} = 'PCT') = (${t.commissionPctBps} IS NOT NULL)`,
    ),
    check(
      'services_rule_pct_bounds',
      sql`${t.commissionPctBps} IS NULL OR ${t.commissionPctBps} BETWEEN 0 AND 10000`,
    ),
    check(
      'services_rule_fixed_present',
      sql`(${t.commissionRuleKind} = 'FIXED') = (${t.commissionFixedAmount} IS NOT NULL)`,
    ),
    check(
      'services_rule_fixed_nonnegative',
      sql`${t.commissionFixedAmount} IS NULL OR ${t.commissionFixedAmount} BETWEEN 0 AND 99999999999.999`,
    ),
    check('services_name_en_controls', sql`${t.nameEn} !~ '[[:cntrl:]]'`),
    check('services_name_ar_controls', sql`${t.nameAr} IS NULL OR ${t.nameAr} !~ '[[:cntrl:]]'`),
    check('services_revision_positive', sql`${t.revision} > 0`),
  ],
);

// نوع الباقة يُباع في كل فروع النشاط؛ صلاحية الأيام من تاريخ البيع حتى نهاية ذلك اليوم بوقت الفرع (PT-Q3).
// مفيش عمولة على الصف: عمولة بيع الباقة قرار خطة لاحق (PT-Q12). التعديل يستبدل المكوّنات كلها، فالجدول الابن وحده يُحذف.
export const packageTypes = pgTable(
  'package_types',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    price: numeric('price', { precision: 14, scale: 3 }).notNull(),
    /** أيام الصلاحية من تاريخ البيع؛ آخر يوم استخدام هو تاريخ البيع زائد هذا العدد. */
    validityDays: integer('validity_days').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'package_types_pkey', columns: [t.companyId, t.id] }),
    unique('package_types_company_business_id_key').on(t.companyId, t.businessId, t.id),
    foreignKey({
      name: 'package_types_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    uniqueIndex('package_types_name_en_key').on(
      t.companyId,
      t.businessId,
      sql`lower(trim(${t.nameEn}))`,
    ),
    uniqueIndex('package_types_name_ar_key')
      .on(t.companyId, t.businessId, sql`lower(trim(${t.nameAr}))`)
      .where(sql`${t.nameAr} IS NOT NULL`),
    check('package_types_name_en_length', sql`char_length(trim(${t.nameEn})) BETWEEN 1 AND 255`),
    check(
      'package_types_name_ar_length',
      sql`${t.nameAr} IS NULL OR char_length(trim(${t.nameAr})) BETWEEN 1 AND 255`,
    ),
    check('package_types_name_en_controls', sql`${t.nameEn} !~ '[[:cntrl:]]'`),
    check(
      'package_types_name_ar_controls',
      sql`${t.nameAr} IS NULL OR ${t.nameAr} !~ '[[:cntrl:]]'`,
    ),
    check('package_types_price_nonnegative', sql`${t.price} BETWEEN 0 AND 99999999999.999`),
    check('package_types_validity_days', sql`${t.validityDays} BETWEEN 1 AND 730`),
    check('package_types_revision_positive', sql`${t.revision} > 0`),
  ],
);

export const packageTypeComponents = pgTable(
  'package_type_components',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    packageTypeId: uuid('package_type_id').notNull(),
    businessId: uuid('business_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    /** عدد الجلسات الأصلي لهذه الخدمة داخل الباقة، من 1 إلى 365. */
    sessions: integer('sessions').notNull(),
    /** ترتيب السطر كما أدخله المدير، من 1 إلى 20. */
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'package_type_components_pkey',
      columns: [t.companyId, t.id],
    }),
    unique('package_type_components_type_service_key').on(
      t.companyId,
      t.packageTypeId,
      t.serviceId,
    ),
    unique('package_type_components_type_position_key').on(
      t.companyId,
      t.packageTypeId,
      t.position,
    ),
    foreignKey({
      name: 'package_type_components_type_fk',
      columns: [t.companyId, t.businessId, t.packageTypeId],
      foreignColumns: [packageTypes.companyId, packageTypes.businessId, packageTypes.id],
    }),
    foreignKey({
      name: 'package_type_components_service_fk',
      columns: [t.companyId, t.businessId, t.serviceId],
      foreignColumns: [services.companyId, services.businessId, services.id],
    }),
    index('package_type_components_service_idx').on(t.companyId, t.serviceId),
    index('package_type_components_type_idx').on(t.companyId, t.businessId, t.packageTypeId),
    check('package_type_components_sessions', sql`${t.sessions} BETWEEN 1 AND 365`),
    check('package_type_components_position', sql`${t.position} BETWEEN 1 AND 20`),
  ],
);

// تصنيفات الخدمات على مستوى النشاط؛ الاسمان مطلوبان ومخزّنان بعد توحيد المسافات.
export const serviceCategories = pgTable(
  'service_categories',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    // فرع الإنشاء يبقى ثابتاً حتى بعد المشاركة؛ لا يتغير بأي مسار تعديل.
    ownerBranchId: uuid('owner_branch_id'),
    // BUSINESS مشترك بين الفروع، وBRANCH خاص بفرع الإنشاء؛ المشاركة اتجاه واحد فقط.
    visibility: text('visibility').notNull(),
    // الإغلاق يُفعّل في 32b-cat-2؛ وجود العمود الآن يحفظ عقد التخزين والقراءة.
    closedAt: timestamp('closed_at', { withTimezone: true }),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'service_categories_pkey', columns: [t.companyId, t.id] }),
    unique('service_categories_company_business_id_key').on(t.companyId, t.businessId, t.id),
    foreignKey({
      name: 'service_categories_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'service_categories_owner_branch_fk',
      columns: [t.companyId, t.businessId, t.ownerBranchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    uniqueIndex('service_categories_business_name_uq').on(
      t.companyId,
      t.businessId,
      sql`lower(${t.nameEn})`,
    ),
    index('service_categories_owner_branch_idx').on(
      t.companyId,
      t.businessId,
      t.ownerBranchId,
    ),
    check('service_categories_name_en_length', sql`char_length(btrim(${t.nameEn})) BETWEEN 1 AND 100`),
    check('service_categories_name_ar_length', sql`char_length(btrim(${t.nameAr})) BETWEEN 1 AND 100`),
    check('service_categories_name_en_controls', sql`${t.nameEn} !~ '[[:cntrl:]]'`),
    check('service_categories_name_ar_controls', sql`${t.nameAr} !~ '[[:cntrl:]]'`),
    check(
      'service_categories_name_en_normalized',
      sql`${t.nameEn} = btrim(regexp_replace(${t.nameEn}, '[[:space:]]+', ' ', 'g'))`,
    ),
    check(
      'service_categories_name_ar_normalized',
      sql`${t.nameAr} = btrim(regexp_replace(${t.nameAr}, '[[:space:]]+', ' ', 'g'))`,
    ),
    check('service_categories_visibility', sql`${t.visibility} IN ('BUSINESS','BRANCH')`),
    check(
      'service_categories_branch_owner_required',
      sql`${t.visibility} <> 'BRANCH' OR ${t.ownerBranchId} IS NOT NULL`,
    ),
    check('service_categories_revision_positive', sql`${t.revision} > 0`),
  ],
);
