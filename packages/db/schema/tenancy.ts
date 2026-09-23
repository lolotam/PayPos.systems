import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// تصنيف الجداول وقواعد الـ RLS في ADR-0003 §2؛ الـ policies والـ FORCE والـ grants في الـ migration المكتوبة بإيد
// (drizzle-kit مبيعرفش يعمل FORCE ROW LEVEL SECURITY). أسماء الأعمدة ماشية مع packages/contracts.

const nameChecks = (table: string, nameEn: unknown, nameAr: unknown) => [
  check(`${table}_name_en_length`, sql`char_length(${nameEn}) BETWEEN 1 AND 255`),
  check(
    `${table}_name_ar_length`,
    sql`${nameAr} IS NULL OR char_length(${nameAr}) BETWEEN 1 AND 255`,
  ),
];

// بيانات مرجعية على مستوى المنصة (ADR-0003 §2.3): مفيش company_id ولا RLS، والـ app بيقراها بس.
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar'),
  nameEn: text('name_en').notNull(),
  // مفتاح لكل module → مفعّل ولا لأ؛ الـ override لكل شركة في company_feature_overrides.
  featureFlags: jsonb('feature_flags')
    .notNull()
    .default(sql`'{}'::jsonb`),
});

// الـ tenant root (ADR-0003 §2.4): الـ id هو مفتاح الشركة نفسه، فمفيش company_id.
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey(),
    nameAr: text('name_ar'),
    nameEn: text('name_en').notNull(),
    // الـ FK على جدول user بتاع Better Auth بيتضاف في T9a لما الجدول يتعمل.
    ownerUserId: uuid('owner_user_id').notNull(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // الشركة بتتقفل ومبتتمسحش — مفيش DELETE grant للـ app.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('companies_plan_id_idx').on(t.planId),
    ...nameChecks('companies', t.nameEn, t.nameAr),
  ],
);

export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    verticalType: text('vertical_type').notNull(),
    nameAr: text('name_ar'),
    nameEn: text('name_en').notNull(),
    currency: text('currency').notNull().default('KWD'),
    timezone: text('timezone').notNull().default('Asia/Kuwait'),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // الـ PK (company_id, id) مش id لوحده (ADR-0007): unique على id لوحده كان هيكشف لشركة A إن id موجود عند B
    // من رسالة الـ duplicate، لأن فحص الـ unique مبيعدّيش على الـ RLS.
    primaryKey({ name: 'businesses_pkey', columns: [t.companyId, t.id] }),
    index('businesses_company_id_created_at_idx').on(t.companyId, t.createdAt),
    check(
      'businesses_vertical_type',
      sql`${t.verticalType} IN ('restaurant', 'salon', 'laundry', 'retail', 'services')`,
    ),
    check('businesses_currency_format', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    ...nameChecks('businesses', t.nameEn, t.nameAr),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').notNull(),
    companyId: uuid('company_id').notNull(),
    businessId: uuid('business_id').notNull(),
    nameAr: text('name_ar'),
    nameEn: text('name_en').notNull(),
    addressAr: text('address_ar'),
    addressEn: text('address_en'),
    geoLat: doublePrecision('geo_lat'),
    geoLng: doublePrecision('geo_lng'),
    openingHours: jsonb('opening_hours'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // FK مركّب على الشركة: فرع شركة A ميقدرش يشاور على business بتاع شركة B — الـ RLS لوحده مبيمنعش ده.
    foreignKey({
      name: 'branches_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    primaryKey({ name: 'branches_pkey', columns: [t.companyId, t.id] }),
    index('branches_company_id_business_id_idx').on(t.companyId, t.businessId),
    check('branches_geo_pair', sql`(${t.geoLat} IS NULL) = (${t.geoLng} IS NULL)`),
    check('branches_geo_lat_range', sql`${t.geoLat} IS NULL OR ${t.geoLat} BETWEEN -90 AND 90`),
    check('branches_geo_lng_range', sql`${t.geoLng} IS NULL OR ${t.geoLng} BETWEEN -180 AND 180`),
    check(
      'branches_address_ar_length',
      sql`${t.addressAr} IS NULL OR char_length(${t.addressAr}) BETWEEN 1 AND 500`,
    ),
    check(
      'branches_address_en_length',
      sql`${t.addressEn} IS NULL OR char_length(${t.addressEn}) BETWEEN 1 AND 500`,
    ),
    ...nameChecks('branches', t.nameEn, t.nameAr),
  ],
);

// الـ flag الفعلي = الـ override لو موجود ومش منتهي، وإلا flag الـ plan (SPEC §4). الـ guard في T9a بيقرا بس.
export const companyFeatureOverrides = pgTable(
  'company_feature_overrides',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    flag: text('flag').notNull(),
    enabled: boolean('enabled').notNull(),
    reason: text('reason').notNull(),
    setBy: uuid('set_by').notNull(),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ name: 'company_feature_overrides_pkey', columns: [t.companyId, t.flag] })],
);
