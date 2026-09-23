import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { companies } from './tenancy.ts';

// PIN الكاشير (ADR-0003 §4 path B و§4.2، PRD D-08): بيثبت مين واقف على جهاز متوافق عليه، وعمره ما بيفتح app.
// الـ hash بس (packages/auth)، PIN واحد لكل موظف في الشركة. tenant data بـ RLS زي أي جدول شركة.
export const cashierPins = pgTable(
  'cashier_pins',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // الـ FK على staff.employees بييجي مع staff في Phase 1 (ADR-0003 §4.2).
    employeeId: uuid('employee_id').notNull(),
    pinHash: text('pin_hash').notNull(),
    // المدير اللي حط الـ PIN — null لو الموظف غيّره بنفسه على الجهاز بعدين (مالوش user).
    setBy: uuid('set_by').references(() => user.id),
    setAt: timestamp('set_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'cashier_pins_pkey', columns: [t.companyId, t.id] }),
    unique('cashier_pins_employee').on(t.companyId, t.employeeId),
    check('cashier_pins_hash_format', sql`${t.pinHash} LIKE 'pbkdf2-sha256$%'`),
    index('cashier_pins_set_by_idx').on(t.setBy),
  ],
);
