import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { permissions } from './identity-access.ts';

// هوية عامة (ADR-0003 §2.1، §3): صلاحيات المنصة وسجلها — مفيش company_id ولا RLS. pospay_auth بيقرا الـ grants
// وبيضيف في السجل بس؛ الكتابة على الـ grants من سكريبت الـ operator (pnpm platform:grant) كـ pospay_owner بس.

export const platformGrants = pgTable(
  'platform_grants',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    permission: text('permission')
      .notNull()
      .references(() => permissions.code),
    // الـ operator اللي شغّل السكريبت — أول grant بيحصل قبل ما أي يوزر يبقى له صلاحية، فده اسم مش user id.
    grantedBy: text('granted_by').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
  },
  (t) => [
    check('platform_grants_permission_scope', sql`${t.permission} LIKE '%:platform'`),
    check('platform_grants_granted_by_length', sql`char_length(${t.grantedBy}) BETWEEN 1 AND 255`),
    check('platform_grants_revocation', sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`),
    // صلاحية واحدة سارية بس لكل يوزر؛ السحب بيسيب الصف ويسجل مين ومتى.
    uniqueIndex('platform_grants_active_key')
      .on(t.userId, t.permission)
      .where(sql`${t.revokedAt} IS NULL`),
    index('platform_grants_permission_idx').on(t.permission),
  ],
);

export const platformAuditLog = pgTable(
  'platform_audit_log',
  {
    id: uuid('id').primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
    // 'user.created' · 'grant.granted' · 'grant.revoked'
    action: text('action').notNull(),
    targetUserId: uuid('target_user_id').references(() => user.id),
    details: jsonb('details')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    check('platform_audit_log_actor_length', sql`char_length(${t.actor}) BETWEEN 1 AND 255`),
    check('platform_audit_log_action_format', sql`${t.action} ~ '^[a-z]+\\.[a-z_]+$'`),
    index('platform_audit_log_target_user_id_idx').on(t.targetUserId),
    index('platform_audit_log_at_idx').on(t.at),
  ],
);

// أدوار فريق المنصة (PRD P0-T9b.4) — جدول لوحده مش roles بتاعة الشركات، عشان مفيش شركة تقدر تدّيها لحد. الأكواد
// مؤقتة (TODO(spec) D-07) ومن غير صلاحيات لحد ما الـ Platform module ييجي في Phase 5؛ صلاحية المنصة النهارده
// platform_grants بس.
export const platformRoles = pgTable(
  'platform_roles',
  {
    code: text('code').primaryKey(),
    nameEn: text('name_en').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('platform_roles_code_format', sql`${t.code} ~ '^[a-z][a-z_]{0,63}$'`),
    check('platform_roles_name_en_length', sql`char_length(${t.nameEn}) BETWEEN 1 AND 255`),
  ],
);
