import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { user } from './identity-auth.ts';
import { branches, companies } from './tenancy.ts';

// جهاز فرع (ADR-0003 §4 path B، PRD P0-T9b.5): بيتسجل بكود pairing، الـ manager بيوافق، وبياخد token مرة واحدة.
// الأسرار عمرها ما بتتخزن — الـ hash بس (packages/auth هو اللي بيعمله). tenant data بـ RLS زي أي جدول شركة.
export const devices = pgTable(
  'devices',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    branchId: uuid('branch_id').notNull(),
    label: text('label').notNull(),
    // اللي الجهاز بيبلّغ بيه عن نفسه — للعرض بس، مش لإثبات الهوية.
    deviceFingerprint: text('device_fingerprint'),
    appVersion: text('app_version'),
    status: text('status').notNull(),
    // hash لسر الاستلام: الجهاز بيستخدمه مرة واحدة ياخد الـ token بعد الموافقة، وبعدها بيتمسح.
    claimHash: text('claim_hash'),
    tokenHash: text('token_hash'),
    // 30 يوم وبيتجدد مع كل اتصال (PRD D-09).
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => user.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => user.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'devices_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'devices_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [branches.companyId, branches.id],
    }),
    check('devices_status', sql`${t.status} IN ('PENDING', 'ACTIVE', 'REVOKED')`),
    check('devices_label_length', sql`char_length(${t.label}) BETWEEN 1 AND 100`),
    check(
      'devices_fingerprint_length',
      sql`${t.deviceFingerprint} IS NULL OR char_length(${t.deviceFingerprint}) BETWEEN 1 AND 255`,
    ),
    check(
      'devices_app_version_length',
      sql`${t.appVersion} IS NULL OR char_length(${t.appVersion}) BETWEEN 1 AND 50`,
    ),
    // الحالة والأسرار ماشيين مع بعض: pending معاه سر استلام، revoked ملوش token، active اتوافق عليه.
    check(
      'devices_state',
      sql`(${t.status} = 'PENDING' AND ${t.tokenHash} IS NULL AND ${t.approvedAt} IS NULL)
        OR (${t.status} = 'ACTIVE' AND ${t.approvedAt} IS NOT NULL AND ${t.approvedBy} IS NOT NULL)
        OR (${t.status} = 'REVOKED' AND ${t.tokenHash} IS NULL AND ${t.claimHash} IS NULL AND ${t.revokedAt} IS NOT NULL)`,
    ),
    check('devices_token_expiry', sql`(${t.tokenHash} IS NULL) = (${t.tokenExpiresAt} IS NULL)`),
    index('devices_company_id_branch_id_idx').on(t.companyId, t.branchId),
    index('devices_approved_by_idx').on(t.approvedBy),
    index('devices_revoked_by_idx').on(t.revokedBy),
  ],
);
