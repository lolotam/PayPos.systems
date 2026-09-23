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

// كل تأثير على module تاني بيعدّي من هنا (CLAUDE.md §4.1): الـ event بيتكتب في نفس transaction الـ use case،
// فيا الاتنين يتسجلوا يا ولا واحد. الـ dispatcher في T7b بيقرا الصفوف اللي published_at بتاعها NULL.
export const outbox = pgTable(
  'outbox',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    // UUID v7 — الترتيب بالـ id هو ترتيب الكتابة جوه نفس المولّد.
    id: uuid('id').notNull(),
    // نوع الـ aggregate اللي اتغير (company, business, order…) والـ id بتاعه.
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // الأعمدة التلاتة دي بس اللي الـ dispatcher يقدر يغيّرها (ADR-0003 §3، T7b).
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    primaryKey({ name: 'outbox_pkey', columns: [t.companyId, t.id] }),
    // الـ dispatcher بيدوّر على اللي لسه متنشرش بالترتيب، عبر كل الشركات.
    index('outbox_unpublished_idx')
      .on(t.createdAt, t.id)
      .where(sql`${t.publishedAt} IS NULL`),
    check('outbox_event_type_format', sql`${t.eventType} ~ '^[A-Z][A-Za-z0-9]{1,99}$'`),
    check('outbox_aggregate_type_format', sql`${t.aggregateType} ~ '^[a-z][a-z0-9_]{1,62}$'`),
    check('outbox_attempts_non_negative', sql`${t.attempts} >= 0`),
  ],
);
