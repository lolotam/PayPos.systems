import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { fileObjects } from './files.ts';
import { user } from './identity-auth.ts';
import { branches, businesses } from './tenancy.ts';

// إعدادات النشاط (PRD P0-T10.1) — صف واحد لكل نشاط، بيتعمل أول ما حد يغيّر حاجة. كل عمود null معناه "زي الـ
// template" (قرار Waleed 2026-09-23: الـ template الأول وبعدين تعديلات العميل)، فالـ template لو اتغير بيوصل لكل نشاط
// ما غيّرش القيمة دي.
export const businessSettings = pgTable(
  'business_settings',
  {
    companyId: uuid('company_id').notNull(),
    businessId: uuid('business_id').notNull(),
    defaultLanguage: text('default_language'),
    calendar: text('calendar'),
    // حد النشاط عند غياب الحد الشخصي؛ null يتركه غير مضبوط ولا يعني سلطة غير محدودة.
    limitBps: integer('limit_bps'),
    // قاعدة الـ VAT (packages/domain TaxRule) — null = مفيش ضريبة. الكويت مفيهاش النهارده، ومفيش route بيكتبها لحد
    // P2-T4 (PRD D-27).
    taxRule: jsonb('tax_rule'),
    // الاسم الرسمي مش نسخة من اسم العرض؛ null = لسه ما اتكتبش (BI-Q2).
    officialNameAr: text('official_name_ar'),
    officialNameEn: text('official_name_en'),
    // ملف الشعار في نفس الشركة؛ null = مفيش شعار، والحذف ممنوع طول ما الصف شاير عليه.
    logoFileId: uuid('logo_file_id'),
    // مفتاح كل تنبيهات الفريق للنشاط (D-B13، AL-Q4)؛ null = شغّال، ورسايل التقييم للزباين ليها مفتاحها لوحدها.
    alertsEnabled: boolean('alerts_enabled'),
    updatedBy: uuid('updated_by').references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'business_settings_pkey', columns: [t.companyId, t.businessId] }),
    foreignKey({
      name: 'business_settings_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    check(
      'business_settings_language',
      sql`${t.defaultLanguage} IS NULL OR ${t.defaultLanguage} IN ('ar', 'en')`,
    ),
    check(
      'business_settings_calendar',
      sql`${t.calendar} IS NULL OR ${t.calendar} IN ('gregorian', 'hijri')`,
    ),
    check(
      'business_settings_limit_bps',
      sql`${t.limitBps} IS NULL OR ${t.limitBps} BETWEEN 0 AND 10000`,
    ),
    check(
      'business_settings_official_name_ar',
      sql`${t.officialNameAr} IS NULL OR char_length(${t.officialNameAr}) BETWEEN 1 AND 255`,
    ),
    check(
      'business_settings_official_name_en',
      sql`${t.officialNameEn} IS NULL OR char_length(${t.officialNameEn}) BETWEEN 1 AND 255`,
    ),
    foreignKey({
      name: 'business_settings_logo_file_fk',
      columns: [t.companyId, t.logoFileId],
      foreignColumns: [fileObjects.companyId, fileObjects.id],
    }).onDelete('restrict'),
    index('business_settings_updated_by_idx').on(t.updatedBy),
    // الفهرس الجزئي يبنى CONCURRENTLY في migration مستقلة (ADR-0033).
    uniqueIndex('business_settings_logo_file_key')
      .on(t.companyId, t.logoFileId)
      .where(sql`${t.logoFileId} IS NOT NULL`),
  ],
);

const ALERT_KINDS_SQL = sql.raw(
  "'SHIFT_NOT_CLOCKED_IN','SHIFT_BREAK_NOT_RETURNED','SHIFT_BREAK_RETURNED_OTHER_BRANCH','SHIFT_ENDS_SOON'," +
    "'ATTENDANCE_EXCEPTION','DOCUMENT_EXPIRING','LATE_SERVICE_SESSION','SERVICE_LINE_EDITED'," +
    "'SERVICE_LINE_CANCELLED','SERVICE_LINE_PERFORMERS_CHANGED','ATTENDANCE_CHANGE_REQUESTED'," +
    "'ATTENDANCE_CHANGE_DECIDED','STATEMENT_AWAITING_REVIEW','STATEMENT_AWAITING_APPROVAL'",
);

// قواعد التنبيه (spec 060 D-B13): صف لكل نوع للنشاط، وصف اختياري لنفس النوع لفرع بيغيّر قاعدة النشاط (AL-Q2).
// الغياب = الافتراضي من جدول الكود (AL-Q5)، فالجدول بيحمل تعديلات العميل بس.
export const alertRules = pgTable(
  'alert_rules',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    // null = قاعدة النشاط؛ غير كده قاعدة الفرع ده اللي بتحل محل قاعدة النشاط لأحداثه.
    branchId: uuid('branch_id'),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull(),
    // المستلمين بالدور (AL-Q3)؛ مستلمين الصلاحية والسياق ثابتين في جدول الكود ومش هنا.
    recipientRoles: text('recipient_roles').array().notNull(),
    // IN_APP بس لحد البند 62b (AL-Q6).
    channels: text('channels').array().notNull(),
    delayMinutes: integer('delay_minutes'),
    leadMinutes: integer('lead_minutes'),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => user.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    primaryKey({ name: 'alert_rules_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'alert_rules_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'alert_rules_branch_fk',
      columns: [t.companyId, t.businessId, t.branchId],
      foreignColumns: [branches.companyId, branches.businessId, branches.id],
    }),
    uniqueIndex('alert_rules_business_kind_key')
      .on(t.companyId, t.businessId, t.kind)
      .where(sql`${t.branchId} IS NULL`),
    uniqueIndex('alert_rules_branch_kind_key')
      .on(t.companyId, t.branchId, t.kind)
      .where(sql`${t.branchId} IS NOT NULL`),
    index('alert_rules_branch_fk_idx').on(t.companyId, t.businessId, t.branchId),
    index('alert_rules_updated_by_idx').on(t.updatedBy),
    check('alert_rules_kind', sql`${t.kind} IN (${ALERT_KINDS_SQL})`),
    check(
      'alert_rules_recipient_roles',
      sql`${t.recipientRoles} <@ ARRAY['owner','general_manager','business_manager','branch_manager']::text[]`,
    ),
    check('alert_rules_channels', sql`${t.channels} <@ ARRAY['IN_APP']::text[]`),
    check(
      'alert_rules_delay_minutes',
      sql`${t.delayMinutes} IS NULL OR ${t.delayMinutes} BETWEEN 1 AND 1440`,
    ),
    check(
      'alert_rules_lead_minutes',
      sql`${t.leadMinutes} IS NULL OR ${t.leadMinutes} BETWEEN 1 AND 1440`,
    ),
    check(
      'alert_rules_document_lead',
      sql`${t.kind} <> 'DOCUMENT_EXPIRING' OR ${t.leadMinutes} IS NULL`,
    ),
    check('alert_rules_revision', sql`${t.revision} >= 1`),
  ],
);
