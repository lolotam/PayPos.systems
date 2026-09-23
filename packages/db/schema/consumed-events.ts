import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { companies } from './tenancy.ts';

// التوصيل at-least-once، والتأثير effect-once (plan v4 T7b): الـ consumer بيكتب الصف ده في نفس transaction التأثير،
// فلو الـ event اتوصل تاني الـ INSERT بيلاقي الصف ومبيعيدش التأثير. المفتاح فيه الـ consumer، لأن event واحد
// بيروح لأكتر من consumer، وصف واحد منهم ميمنعش التاني.
export const consumedEvents = pgTable(
  'consumed_events',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    // اسم ثابت للـ consumer (inventory.on-order-completed) — تغييره بيخلي الـ events القديمة تتطبق تاني.
    consumerId: text('consumer_id').notNull(),
    // outbox.id — مفيش FK لأن الـ outbox ممكن يتنضف بعدين، والصف ده لازم يفضل.
    eventId: uuid('event_id').notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'consumed_events_pkey', columns: [t.companyId, t.consumerId, t.eventId] }),
    check('consumed_events_consumer_id_format', sql`${t.consumerId} ~ '^[a-z][a-z0-9.-]{1,99}$'`),
  ],
);
