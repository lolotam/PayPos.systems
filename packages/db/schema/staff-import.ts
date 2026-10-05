import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { fileObjects } from './files.ts';
import { user } from './identity-auth.ts';
import { businesses, companies } from './tenancy.ts';

// معاينة استيراد محفوظة: صفوف مُطبَّعة وأخطاء مسمّاة فقط، وتنتهي بعد 24 ساعة وتُستهلك مرة واحدة.
// إعادة استخدامها لاحقاً لاستيراد الخدمات والعملاء والباقات بنفس المحرك (ADR-0034).
export const importPreviews = pgTable(
  'import_previews',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    // نوع الكيان المستورد؛ مفتوح للنمو (employees, services, customers, open_packages).
    entity: text('entity').notNull(),
    fileId: uuid('file_id').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    status: text('status').notNull().default('ready'),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    createdCount: integer('created_count').notNull().default(0),
    errorCode: text('error_code'),
    rowCount: integer('row_count').notNull(),
    errorCount: integer('error_count').notNull(),
    rows: jsonb('rows').notNull(),
    errors: jsonb('errors').notNull(),
  },
  (t) => [
    primaryKey({ name: 'import_previews_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'import_previews_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'import_previews_file_fk',
      columns: [t.companyId, t.fileId],
      foreignColumns: [fileObjects.companyId, fileObjects.id],
    }),
    index('import_previews_company_business_created_idx').on(
      t.companyId,
      t.businessId,
      t.createdAt,
    ),
    index('import_previews_company_file_idx').on(t.companyId, t.fileId),
    index('import_previews_company_creator_idx').on(t.companyId, t.createdBy),
    index('import_previews_company_status_requested_idx').on(
      t.companyId,
      t.status,
      t.requestedAt,
      t.id,
    ),
    check('import_previews_entity_format', sql`${t.entity} ~ '^[a-z][a-z0-9_]{1,31}$'`),
    check('import_previews_row_count', sql`${t.rowCount} BETWEEN 0 AND 500`),
    check('import_previews_error_count', sql`${t.errorCount} >= 0`),
    check('import_previews_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      'import_previews_status',
      sql`${t.status} IN ('ready','commit_requested','committed','failed')`,
    ),
    check('import_previews_created_count', sql`${t.createdCount} BETWEEN 0 AND 500`),
    check(
      'import_previews_committed_consistent',
      sql`(${t.status} = 'committed') = (${t.committedAt} IS NOT NULL)`,
    ),
    check(
      'import_previews_failed_error',
      sql`${t.status} <> 'failed' OR ${t.errorCode} IS NOT NULL`,
    ),
    check(
      'import_previews_count_committed',
      sql`${t.status} = 'committed' OR ${t.createdCount} = 0`,
    ),
    check(
      'import_previews_requested_at',
      sql`${t.status} <> 'commit_requested' OR ${t.requestedAt} IS NOT NULL`,
    ),
  ],
);
