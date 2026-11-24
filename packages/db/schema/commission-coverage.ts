import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './tenancy.ts';

// صف واحد لكل شركة: هدف القفل الوحيد ومفتاح الإبطال الوحيد لإثبات التغطية (ADR-0054، إضافة 2026-11-22 §1). يُكتب
// من دوال definer فقط؛ التوليد يرتفع بـ generation = generation + 1 على الصف المقفول، فلا يحتاج تسلسلًا.
export const commissionCoverageState = pgTable(
  'commission_coverage_state',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // رقم الإبطال: 0 يعني لا إثبات، والإثبات الحالي هو اللي توليده يساوي هذا الرقم.
    generation: bigint('generation', { mode: 'bigint' }).notNull().default(sql`0`),
    bumpedAt: timestamp('bumped_at', { withTimezone: true }).notNull().defaultNow(),
    // سبب آخر رفع للتوليد، نص ثابت قصير بحروف كبيرة (RELEASE، SWITCH، INVALIDATED، ISSUED).
    reason: text('reason').notNull().default('ENSURE'),
  },
  (t) => [
    primaryKey({ name: 'commission_coverage_state_pkey', columns: [t.companyId, t.id] }),
    unique('commission_coverage_state_company_key').on(t.companyId),
    check('commission_coverage_state_generation', sql`${t.generation} >= 0`),
    check('commission_coverage_state_reason', sql`${t.reason} ~ '^[A-Z][A-Z_]{1,49}$'`),
  ],
);

// إثبات التغطية: للإضافة فقط، ولا يُعدَّل ولا يُحذف (تريغر). يصدره دالة definer واحدة بعد تحقق من تقرير COVERED؛
// الأعمدة تخزّن نطاق ما تحقّق منه وهوية قاعدة البيانات وقواعد الإصدار.
export const commissionCoverageProofs = pgTable(
  'commission_coverage_proofs',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    // التوليد الذي منحته دالة الإصدار بعد أخذ قفل صف الحالة؛ هو ترتيب الإصدار ولا يُقارن بأي توقيت.
    generation: bigint('generation', { mode: 'bigint' }).notNull(),
    version: integer('version').notNull(),
    // كل أنشطة الشركة وقت الإصدار، مرتبة وغير فارغة.
    businessIds: uuid('business_ids').array().notNull(),
    tipFrom: date('tip_from', { mode: 'string' }).notNull(),
    tipTo: date('tip_to', { mode: 'string' }).notNull(),
    // حد البقشيش U: تاريخ الإصدار بـUTC من ساعة PostgreSQL زائد يوم.
    tipDayBound: date('tip_day_bound', { mode: 'string' }).notNull(),
    countedTypes: text('counted_types').array().notNull(),
    consumerId: text('consumer_id').notNull(),
    // حد التقرير والحد الذي تحقّقت منه الدالة بنفسها؛ NULL لشركة بلا أحداث معدودة محتفظ بها (#1223 البند 2).
    reportThroughId: uuid('report_through_id'),
    verifiedThroughId: uuid('verified_through_id'),
    databaseName: text('database_name').notNull(),
    systemId: bigint('system_id', { mode: 'bigint' }).notNull(),
    // للتدقيق فقط؛ لا يدخل أي مقارنة.
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    runId: text('run_id').notNull(),
    release: text('release').notNull(),
    issuedBy: text('issued_by').notNull(),
  },
  (t) => [
    primaryKey({ name: 'commission_coverage_proofs_pkey', columns: [t.companyId, t.id] }),
    unique('commission_coverage_proofs_generation_key').on(t.companyId, t.generation),
    foreignKey({
      name: 'commission_coverage_proofs_state_fk',
      columns: [t.companyId],
      foreignColumns: [commissionCoverageState.companyId],
    }),
    check('commission_coverage_proofs_generation', sql`${t.generation} >= 1`),
    check('commission_coverage_proofs_version', sql`${t.version} >= 1`),
    check('commission_coverage_proofs_businesses', sql`cardinality(${t.businessIds}) >= 1`),
    check('commission_coverage_proofs_tip_range', sql`${t.tipFrom} <= ${t.tipTo}`),
    check(
      'commission_coverage_proofs_labels',
      sql`char_length(${t.runId}) BETWEEN 1 AND 100 AND char_length(${t.release}) BETWEEN 1 AND 100
        AND char_length(${t.issuedBy}) BETWEEN 1 AND 100`,
    ),
  ],
);
