import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './identity-auth.ts';
import { employees } from './staff.ts';
import { companies } from './tenancy.ts';

// كود الحضور اعتماد حامل؛ لا نخزن إلا HMAC مفصولاً بالشركة ولاحقة العرض.
export const employeeCards = pgTable(
  'employee_cards',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    businessId: uuid('business_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    cardCodeHash: text('card_code_hash').notNull(),
    cardCodeSuffix: text('card_code_suffix').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    issuedBy: uuid('issued_by')
      .notNull()
      .references(() => user.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => user.id),
  },
  (t) => [
    primaryKey({ name: 'employee_cards_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'employee_cards_employee_fk',
      columns: [t.companyId, t.businessId, t.employeeId],
      foreignColumns: [employees.companyId, employees.businessId, employees.id],
    }),
    uniqueIndex('employee_cards_active_employee_key')
      .on(t.companyId, t.employeeId)
      .where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex('employee_cards_active_code_key')
      .on(t.companyId, t.cardCodeHash)
      .where(sql`${t.revokedAt} IS NULL`),
    index('employee_cards_employee_history_idx').on(t.companyId, t.employeeId, t.issuedAt),
    index('employee_cards_business_idx').on(t.companyId, t.businessId),
    index('employee_cards_issued_by_idx').on(t.issuedBy),
    index('employee_cards_revoked_by_idx').on(t.revokedBy),
    check('employee_cards_code_hash', sql`${t.cardCodeHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'employee_cards_code_suffix',
      sql`char_length(${t.cardCodeSuffix}) BETWEEN 1 AND 4 AND ${t.cardCodeSuffix} ~ '^[!-~]+$'`,
    ),
    check('employee_cards_revoked_pair', sql`(${t.revokedAt} IS NULL) = (${t.revokedBy} IS NULL)`),
  ],
);
