import {
  bigint,
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './identity-auth.ts';

// هوية عامة ADR-0013 §8؛ بيانات الاعتماد لا تدخل ربط الموظف ولا تخرج من auth.
export const passkey = pgTable(
  'passkey',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    credentialID: text('credential_id').notNull(),
    publicKey: text('public_key').notNull(),
    // عداد WebAuthn غير مالي؛ bigint SQL يستوعب uint32 كاملاً ويعيده number للـ verifier.
    counter: bigint('counter', { mode: 'number' }).notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }),
    aaguid: text('aaguid'),
  },
  (t) => [
    uniqueIndex('passkey_credential_id_key').on(t.credentialID),
    index('passkey_user_idx').on(t.userId),
  ],
);
