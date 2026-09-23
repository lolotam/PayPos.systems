import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './tenancy.ts';

// سجل التغييرات الحساسة (CLAUDE.md §8): أسعار، صلاحيات، مدفوعات، إعدادات… بيتكتب في نفس transaction التغيير،
// وبيفضل للأبد — الـ app عنده INSERT و SELECT بس، مفيش UPDATE ولا DELETE.
export const auditLog = pgTable(
  'audit_log',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // NULL = تغيير عمله النظام نفسه (job في الـ worker) مش مستخدم.
    actorUserId: uuid('actor_user_id'),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'audit_log_pkey', columns: [t.companyId, t.id] }),
    index('audit_log_company_id_at_idx').on(t.companyId, t.at),
    index('audit_log_company_id_entity_idx').on(t.companyId, t.entity, t.entityId),
    check('audit_log_entity_format', sql`${t.entity} ~ '^[a-z][a-z0-9_]{1,62}$'`),
    check('audit_log_action_format', sql`${t.action} ~ '^[a-z][a-z0-9_.]{1,62}$'`),
  ],
);
