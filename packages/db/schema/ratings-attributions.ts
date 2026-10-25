import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { ratingPerformers, ratings } from './ratings.ts';
import { companies } from './tenancy.ts';

export const ratingAttributions = pgTable(
  'rating_attributions',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    ratingId: uuid('rating_id').notNull(),
    requestId: uuid('request_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    businessId: uuid('business_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    stars: smallint('stars').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'rating_attributions_pkey', columns: [t.companyId, t.id] }),
    unique('rating_attributions_rating_employee_key').on(t.companyId, t.ratingId, t.employeeId),
    foreignKey({
      name: 'rating_attributions_rating_fk',
      columns: [
        t.companyId,
        t.ratingId,
        t.requestId,
        t.businessId,
        t.branchId,
        t.stars,
        t.submittedAt,
      ],
      foreignColumns: [
        ratings.companyId,
        ratings.id,
        ratings.requestId,
        ratings.businessId,
        ratings.branchId,
        ratings.stars,
        ratings.submittedAt,
      ],
    }),
    foreignKey({
      name: 'rating_attributions_performer_fk',
      columns: [t.companyId, t.businessId, t.requestId, t.employeeId],
      foreignColumns: [
        ratingPerformers.companyId,
        ratingPerformers.businessId,
        ratingPerformers.requestId,
        ratingPerformers.employeeId,
      ],
    }),
    index('rating_attributions_employee_idx').on(t.companyId, t.employeeId, t.submittedAt),
    index('rating_attributions_performer_idx').on(
      t.companyId,
      t.businessId,
      t.requestId,
      t.employeeId,
    ),
    index('rating_attributions_branch_idx').on(
      t.companyId,
      t.businessId,
      t.branchId,
      t.submittedAt,
    ),
    check('rating_attributions_stars', sql`${t.stars} BETWEEN 1 AND 5`),
  ],
);
