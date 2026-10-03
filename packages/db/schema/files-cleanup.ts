import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  foreignKey,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { fileObjects } from './files.ts';

// المفتاح المملوك يبقى للأبد؛ إعادة المصالحة تمنع بايتات محاولة قديمة من البقاء بلا مالك.
export const fileCleanupObjects = pgTable(
  'file_cleanup_objects',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    fileId: uuid('file_id').notNull(),
    objectKey: text('object_key').notNull(),
    kind: text('kind').$type<'STAGING' | 'CANDIDATE'>().notNull(),
    verificationLeaseId: uuid('verification_lease_id'),
    // لا تعتبر نتيجة الحذف الأولى نهائية طالما قد يعاد PUT أو يستأنف عامل قديم.
    expiryAt: timestamp('expiry_at', { withTimezone: true }).notNull(),
    cleanupAfter: timestamp('cleanup_after', { withTimezone: true }).notNull(),
    state: text('state').$type<'OWNED' | 'PUBLISHED' | 'DELETING'>().notNull().default('OWNED'),
    cleanedAt: timestamp('cleaned_at', { withTimezone: true }),
    leaseId: uuid('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'file_cleanup_objects_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'file_cleanup_objects_file_fk',
      columns: [t.companyId, t.fileId],
      foreignColumns: [fileObjects.companyId, fileObjects.id],
    }),
    unique('file_cleanup_objects_key_unique').on(t.companyId, t.objectKey),
    index('file_cleanup_objects_company_file_idx').on(t.companyId, t.fileId),
    index('file_cleanup_objects_due_idx')
      .on(t.companyId, t.cleanupAfter)
      .where(sql`${t.state} <> 'PUBLISHED'`),
    check('file_cleanup_objects_kind', sql`${t.kind} IN ('STAGING','CANDIDATE')`),
    check(
      'file_cleanup_objects_state',
      sql`${t.state} IN ('OWNED','PUBLISHED','DELETING') AND (${t.state} <> 'PUBLISHED' OR (${t.kind} = 'CANDIDATE' AND ${t.cleanedAt} IS NULL))`,
    ),
  ],
);
