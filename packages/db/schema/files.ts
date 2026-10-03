import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  primaryKey,
  foreignKey,
  index,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { businesses, branches, companies } from './tenancy.ts';
import { permissions } from './identity-access.ts';

export const fileObjects = pgTable(
  'file_objects',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id'),
    ownerModule: text('owner_module').notNull(),
    ownerEntityId: uuid('owner_entity_id').notNull(),
    // مفتاح الرفع مؤقت؛ النسخة الصالحة تحصل على مفتاح مختلف لا يعرفه رابط PUT.
    stagingKey: text('staging_key').notNull(),
    storageKey: text('storage_key'),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    requiredPermission: text('required_permission')
      .notNull()
      .references(() => permissions.code),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED'>()
      .notNull()
      .default('PENDING'),
    // يسمح باستكمال job تعطل دون إبقاء معاملة مفتوحة أثناء الاتصال بالمزود.
    leaseId: uuid('lease_id'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    rejectionCode: text('rejection_code'),
    // owner decision 2026-10-03: المؤكد لا يعد مهجوراً؛ نحفظ الأثر بعد حذف جسم التخزين.
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    purgeStartedAt: timestamp('purge_started_at', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'file_objects_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'file_objects_business_fk',
      columns: [t.companyId, t.businessId],
      foreignColumns: [businesses.companyId, businesses.id],
    }),
    foreignKey({
      name: 'file_objects_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [branches.companyId, branches.id],
    }),
    unique('file_objects_staging_key_unique').on(t.companyId, t.stagingKey),
    unique('file_objects_storage_key_unique').on(t.companyId, t.storageKey),
    index('file_objects_company_business_idx').on(t.companyId, t.businessId, t.createdAt),
    index('file_objects_company_branch_idx').on(t.companyId, t.branchId),
    index('file_objects_company_creator_idx').on(t.companyId, t.createdBy),
    index('file_objects_company_owner_idx').on(t.companyId, t.ownerModule, t.ownerEntityId),
    index('file_objects_retention_pending_idx')
      .on(t.companyId, t.createdAt)
      .where(sql`${t.status} = 'PENDING' AND ${t.confirmedAt} IS NULL AND ${t.purgedAt} IS NULL`),
    index('file_objects_retention_rejected_idx')
      .on(t.companyId, t.rejectedAt)
      .where(sql`${t.status} = 'REJECTED' AND ${t.purgedAt} IS NULL`),
    index('file_objects_permission_idx').on(t.requiredPermission),
    check('file_objects_size', sql`${t.sizeBytes} BETWEEN 1 AND 10485760`),
    check(
      'file_objects_type',
      sql`${t.contentType} IN ('application/pdf','image/jpeg','image/png')`,
    ),
    check('file_objects_state', sql`${t.status} IN ('PENDING','VERIFYING','READY','REJECTED')`),
    check('file_objects_ready_key', sql`(${t.status} = 'READY') = (${t.storageKey} IS NOT NULL)`),
    check(
      'file_objects_permission_scope',
      sql`${t.requiredPermission} ~ '^[a-z]+:[a-z-]+:(company|business|branch)$' AND (${t.requiredPermission} NOT LIKE '%:branch' OR ${t.branchId} IS NOT NULL)`,
    ),
  ],
);

export const fileAccessAudit = pgTable(
  'file_access_audit',
  {
    companyId: uuid('company_id').notNull(),
    id: uuid('id').notNull(),
    fileId: uuid('file_id').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull(),
    outcome: text('outcome').$type<'ALLOW' | 'DENY'>().notNull(),
  },
  (t) => [
    primaryKey({ name: 'file_access_audit_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'file_access_audit_file_fk',
      columns: [t.companyId, t.fileId],
      foreignColumns: [fileObjects.companyId, fileObjects.id],
    }),
    index('file_access_audit_company_file_idx').on(t.companyId, t.fileId, t.accessedAt),
    index('file_access_audit_company_actor_idx').on(t.companyId, t.actorUserId),
    check('file_access_audit_outcome', sql`${t.outcome} IN ('ALLOW','DENY')`),
  ],
);
