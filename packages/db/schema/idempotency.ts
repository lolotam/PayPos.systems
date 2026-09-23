import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { companies } from './tenancy.ts';

// الرد الحقيقي بيتخزن عشان الـ retry يرجع نفس الرد بالظبط (plan v4 T7). الـ claim والتأثير والرد في transaction
// واحدة، فمفيش حالة IN_FLIGHT بتتسجل: الـ commit فيه الرد، والـ rollback بيشيل الـ claim كمان.
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    // COMPANY لكل كتابة جوه شركة؛ USER لكتابات قبل ما الشركة توجد (onboard-company بس النهارده).
    scopeType: text('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    companyId: uuid('company_id').references(() => companies.id),
    userId: uuid('user_id'),
    // اسم العملية (onboard-company, create-business…) — نفس الـ key في عمليتين مختلفتين مش تكرار.
    operation: text('operation').notNull(),
    key: text('key').notNull(),
    // sha256 للطلب: نفس الـ key بـ body مختلف بيترفض بـ 422 بدل ما يرجّع رد طلب تاني.
    requestFingerprint: text('request_fingerprint').notNull(),
    // NULL بس جوه الـ transaction اللي عملت الـ claim؛ trigger متأجل بيرفض الـ commit من غيرهم.
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    // الـ scope جوه المفتاح: key شركة A ميتصادمش أبداً مع key شركة B، فرسالة الـ duplicate متكشفش حاجة.
    primaryKey({
      name: 'idempotency_keys_pkey',
      columns: [t.scopeType, t.scopeId, t.operation, t.key],
    }),
    index('idempotency_keys_expires_at_idx').on(t.expiresAt),
    index('idempotency_keys_company_id_idx').on(t.companyId),
    index('idempotency_keys_user_id_idx').on(t.userId),
    check(
      'idempotency_keys_scope',
      sql`(${t.scopeType} = 'COMPANY' AND ${t.companyId} IS NOT NULL AND ${t.scopeId} = ${t.companyId})
          OR (${t.scopeType} = 'USER' AND ${t.userId} IS NOT NULL AND ${t.scopeId} = ${t.userId})`,
    ),
    // ASCII ظاهر بس (من ! لـ ~)، من غير مسافات ولا حروف تحكم — نفس اللي الـ API بيقبله في الـ header.
    check('idempotency_keys_key_format', sql`${t.key} ~ '^[!-~]{1,255}$'`),
    check('idempotency_keys_operation_format', sql`${t.operation} ~ '^[a-z][a-z0-9-]{1,62}$'`),
    check('idempotency_keys_fingerprint_format', sql`${t.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      'idempotency_keys_response_status',
      sql`${t.responseStatus} IS NULL OR ${t.responseStatus} BETWEEN 200 AND 599`,
    ),
    check('idempotency_keys_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);
