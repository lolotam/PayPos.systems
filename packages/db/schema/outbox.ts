import { sql } from 'drizzle-orm';
import {
  bigint,
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
    // ترتيب الإدخال الفعلي (مش created_at، اللي هو بداية الـ transaction): الترتيب per aggregate ماشي عليه.
    // الـ producers اللي بيكتبوا لنفس الـ aggregate لازم يعملوا lock على صفه، فالـ seq بيطابق ترتيب الـ commit.
    seq: bigint('seq', { mode: 'bigint' }).notNull().generatedAlwaysAsIdentity(),
    // أعمدة التوصيل دي بس اللي الـ dispatcher يقدر يغيّرها (ADR-0003 §3، T7b).
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    // نوع الخطأ وكوده بس (مفيش message) — نفس قاعدة الـ logs.
    lastError: text('last_error'),
    // المحاولة الجاية مش قبل الوقت ده: backoff بعد الفشل، أو مدة الـ lease وقت ما الـ event متاخد للتوصيل.
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    // بعد آخر محاولة فاشلة الـ event بيقف هنا ومحدش بيعيده لوحده؛ الـ events اللي بعده لنفس الـ aggregate بتستنى.
    parkedAt: timestamp('parked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ name: 'outbox_pkey', columns: [t.companyId, t.id] }),
    // الـ dispatcher بيدوّر على اللي لسه متنشرش بالترتيب، عبر كل الشركات.
    index('outbox_unpublished_idx')
      .on(t.seq)
      .where(sql`${t.publishedAt} IS NULL`),
    // الترتيب per aggregate: الـ dispatcher بيدوّر إذا كان فيه event أقدم لسه متنشرش لنفس الـ aggregate.
    index('outbox_unpublished_aggregate_idx')
      .on(t.companyId, t.aggregateType, t.aggregateId, t.seq)
      .where(sql`${t.publishedAt} IS NULL`),
    check('outbox_event_type_format', sql`${t.eventType} ~ '^[A-Z][A-Za-z0-9]{1,99}$'`),
    check('outbox_aggregate_type_format', sql`${t.aggregateType} ~ '^[a-z][a-z0-9_]{1,62}$'`),
    check('outbox_attempts_non_negative', sql`${t.attempts} >= 0`),
  ],
);
