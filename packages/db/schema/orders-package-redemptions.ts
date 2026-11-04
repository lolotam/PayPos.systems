import { sql } from 'drizzle-orm';
import { check, foreignKey, index, pgTable, primaryKey, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { companies } from './tenancy.ts';
import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';
import { packageComponents } from './orders-packages.ts';

// سجل الاسترداد لا يُحذف؛ العكس انتقال واحد موثّق بإلغاء السطر نفسه.
export const packageRedemptions = pgTable('package_redemptions', {
  companyId: uuid('company_id').notNull().references(() => companies.id),
  id: uuid('id').notNull(), businessId: uuid('business_id').notNull(),
  entitlementId: uuid('entitlement_id').notNull(), componentId: uuid('component_id').notNull(),
  // الروابط الدائرية إلى slot وline وcancellation مؤجلة في SQL الخاص بـ43-1.
  slotId: uuid('slot_id').notNull(), lineId: uuid('line_id').notNull(),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull(),
  recordedBy: uuid('recorded_by').notNull().references(() => user.id),
  recordedByMembershipId: uuid('recorded_by_membership_id').notNull(),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversalCancellationId: uuid('reversal_cancellation_id'),
}, (t) => [
  primaryKey({ name: 'package_redemptions_pkey', columns: [t.companyId, t.id] }),
  unique('package_redemptions_business_id_key').on(t.companyId, t.businessId, t.id),
  unique('package_redemptions_line_key').on(t.companyId, t.lineId),
  uniqueIndex('package_redemptions_live_slot_key').on(t.companyId, t.slotId).where(sql`${t.reversedAt} IS NULL`),
  foreignKey({ name: 'package_redemptions_component_fk', columns: [t.companyId, t.businessId, t.entitlementId, t.componentId], foreignColumns: [packageComponents.companyId, packageComponents.businessId, packageComponents.entitlementId, packageComponents.id] }),
  foreignKey({ name: 'package_redemptions_membership_fk', columns: [t.companyId, t.recordedBy, t.recordedByMembershipId], foreignColumns: [memberships.companyId, memberships.userId, memberships.id] }),
  index('package_redemptions_component_fk_idx').on(t.companyId, t.businessId, t.entitlementId, t.componentId),
  index('package_redemptions_slot_fk_idx').on(t.companyId, t.businessId, t.slotId),
  index('package_redemptions_line_fk_idx').on(t.companyId, t.businessId, t.lineId),
  index('package_redemptions_actor_fk_idx').on(t.recordedBy),
  index('package_redemptions_membership_fk_idx').on(t.companyId, t.recordedBy, t.recordedByMembershipId),
  index('package_redemptions_cancellation_fk_idx').on(t.companyId, t.reversalCancellationId).where(sql`${t.reversalCancellationId} IS NOT NULL`),
  check('package_redemptions_reversal_pair', sql`(${t.reversedAt} IS NULL) = (${t.reversalCancellationId} IS NULL)`),
]);
