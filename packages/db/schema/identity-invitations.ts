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

import { memberships } from './identity-access.ts';
import { user } from './identity-auth.ts';
import { companies } from './tenancy.ts';

const SCOPE_TYPES = sql`('COMPANY', 'BUSINESS', 'BRANCH')`;
const STATES = sql`('PENDING', 'ACTIVE', 'CANCELLED')`;

// دعوة عضو (G1): صف واحد لكل دعوة في الشركة. مفيش توكن ولا رابط ولا إيميل صريح — بصمة الإيميل فقط.
export const memberInvitations = pgTable(
  'member_invitations',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    id: uuid('id').notNull(),
    // بصمة الإيميل المدعوّ (HMAC) — الإيميل نفسه عمره ما بيتخزن.
    emailHash: text('email_hash').notNull(),
    userId: uuid('user_id').references(() => user.id),
    membershipId: uuid('membership_id'),
    roleCode: text('role_code').notNull(),
    scopeType: text('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    // المالك اللي عمل الدعوة — هو الوحيد اللي يقدر يصدر رابط جديد ليها.
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => user.id),
    state: text('state').notNull(),
    // حجز الإصدار: أول طلب بيحجز، فالطلب المتزامن التاني بيتحوّل لمسار إعادة الإصدار.
    linkClaimedAt: timestamp('link_claimed_at', { withTimezone: true }),
    // وقت كتابة التوكن فعلاً — بيتختم بعد الكتابة بس.
    linkIssuedAt: timestamp('link_issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'member_invitations_pkey', columns: [t.companyId, t.id] }),
    foreignKey({
      name: 'member_invitations_membership_fk',
      columns: [t.companyId, t.membershipId],
      foreignColumns: [memberships.companyId, memberships.id],
    }),
    // دعوة حية واحدة لكل إيميل في الشركة: مالكين اتنين على نفس الإيميل يطلعوا عضوية واحدة. الصف الملغي
    // (CANCELLED) بيفضل للتدقيق وما بيحجزش الإيميل، فدعوة جديدة لنفس الإيميل بتعدي لما يبقى حر.
    uniqueIndex('member_invitations_company_id_email_hash_live_key')
      .on(t.companyId, t.emailHash)
      .where(sql`${t.state} <> 'CANCELLED'`),
    index('member_invitations_company_id_state_idx').on(t.companyId, t.state),
    index('member_invitations_company_id_user_id_idx').on(t.companyId, t.userId),
    // كل مفتاح أجنبي له فهرس (CLAUDE.md §5).
    index('member_invitations_invited_by_idx').on(t.invitedBy),
    // الـ FK على user_id وحده (جدول اليوزر عام بلا company_id): فحص المرجع عند حذف يوزر محتاج فهرس
    // بيبدأ بـ user_id.
    index('member_invitations_user_id_idx').on(t.userId),
    index('member_invitations_membership_idx').on(t.companyId, t.membershipId),
    check('member_invitations_state', sql`${t.state} IN ${STATES}`),
    check('member_invitations_scope_type', sql`${t.scopeType} IN ${SCOPE_TYPES}`),
    check(
      'member_invitations_email_hash_length',
      sql`char_length(${t.emailHash}) BETWEEN 40 AND 64`,
    ),
  ],
);
