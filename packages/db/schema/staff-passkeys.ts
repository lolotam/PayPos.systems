import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './identity-auth.ts';
import { passkey } from './identity-passkey.ts';
import { employees } from './staff.ts';
import { companies } from './tenancy.ts';

export const employeePasskeys = pgTable(
  'employee_passkeys',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    // هوية opaque فقط؛ المفتاح العام والعداد في جدول auth العالمي.
    passkeyId: uuid('passkey_id')
      .notNull()
      .references(() => passkey.id),
    revision: integer('revision').notNull(),
    boundAt: timestamp('bound_at', { withTimezone: true }).notNull(),
    boundBy: uuid('bound_by')
      .notNull()
      .references(() => user.id),
    unboundAt: timestamp('unbound_at', { withTimezone: true }),
    unboundBy: uuid('unbound_by').references(() => user.id),
  },
  (t) => [
    primaryKey({ name: 'employee_passkeys_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'employee_passkeys_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    uniqueIndex('employee_passkeys_active_employee_key')
      .on(t.companyId, t.employeeId)
      .where(sql`${t.unboundAt} IS NULL`),
    index('employee_passkeys_employee_history_idx').on(t.companyId, t.employeeId, t.boundAt),
    index('employee_passkeys_employee_cursor_idx').on(t.companyId, t.employeeId, t.id),
    index('employee_passkeys_business_idx').on(t.companyId, t.businessId),
    index('employee_passkeys_credential_idx').on(t.companyId, t.passkeyId),
    index('employee_passkeys_bound_by_idx').on(t.boundBy),
    index('employee_passkeys_unbound_by_idx').on(t.unboundBy),
    check('employee_passkeys_revision_positive', sql`${t.revision} > 0`),
    check(
      'employee_passkeys_unbound_pair',
      sql`(${t.unboundAt} IS NULL) = (${t.unboundBy} IS NULL)`,
    ),
  ],
);
