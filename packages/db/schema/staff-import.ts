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
    check('import_previews_entity_format', sql`${t.entity} ~ '^[a-z][a-z0-9_]{1,31}$'`),
    check('import_previews_row_count', sql`${t.rowCount} BETWEEN 0 AND 500`),
    check('import_previews_error_count', sql`${t.errorCount} >= 0`),
    check('import_previews_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
