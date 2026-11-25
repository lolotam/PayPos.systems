import { memberInvitationPage, type PageQuery } from '@pospay/contracts';
import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';

/** جملة صفحة الدعوات (شاشة «دعوة عضو»): مرتبة بالمفتاح الأساسي (company_id, id) والـ cursor هو آخر id. */
export function invitationsPageStatement(
  companyId: string,
  cursor: string | undefined,
  rows: number,
) {
  return sql`
    SELECT id, user_id, membership_id, invited_by, role_code, scope_type, scope_id, state,
           link_issued_at, created_at
    FROM member_invitations
    WHERE company_id = ${companyId}
      ${cursor === undefined ? sql`` : sql`AND id > ${cursor}::uuid`}
    ORDER BY id LIMIT ${rows}`;
}

/**
 * بيقرأ دعوات الشركة للوحة الدعوات: مفيش رابط ولا توكن ولا إيميل صريح في الصف، وبيحسب
 * `can_reissue` (حالة PENDING ومن نفس الداعي والعضوية مكتوبة) عشان زر الإصدار يظهر لمن
 * يستحقه فقط. حالة الكلمة المرور بتتحسب وقت القراءة، لأن مسار القراءة ممنوع يكتب (§7.1).
 */
export async function listMemberInvitations(
  db: TenantWrappers,
  actor: { companyId: string; userId: string },
  page: PageQuery,
  hasPasswords: (userIds: readonly string[]) => Promise<ReadonlySet<string>>,
) {
  const rows = await db.withTenant(
    actor.companyId,
    async (tx) =>
      tx.execute<{
        id: string;
        user_id: string | null;
        membership_id: string | null;
        invited_by: string;
        role_code: string;
        scope_type: 'COMPANY' | 'BUSINESS' | 'BRANCH';
        scope_id: string;
        state: 'PENDING' | 'ACTIVE' | 'CANCELLED';
        link_issued_at: string | null;
        created_at: string;
      }>(invitationsPageStatement(actor.companyId, page.cursor, page.limit + 1)),
    { userId: actor.userId, readOnly: true },
  );
  const items = rows.slice(0, page.limit);
  // حالة كلمة المرور للصفحة كلها في قراءة واحدة: قراءة لكل صف المعلّق كانت N+1 على جداول الهوية.
  const pendingUserIds = items.flatMap((row) =>
    row.state === 'PENDING' && row.user_id !== null ? [row.user_id] : [],
  );
  const withPassword =
    pendingUserIds.length === 0 ? new Set<string>() : await hasPasswords(pendingUserIds);
  const states = items.map((row) =>
    row.state === 'PENDING' && row.user_id !== null && withPassword.has(row.user_id)
      ? 'ACTIVE'
      : row.state,
  );
  return memberInvitationPage.parse({
    items: items.map((row, position) => ({
      id: row.id,
      role_code: row.role_code,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      state: states[position],
      // execute الخام بيرجّع التواريخ نصوص ISO، فالتحويل هنا قبل العقد.
      link_issued_at:
        row.link_issued_at === null ? null : new Date(row.link_issued_at).toISOString(),
      created_at: new Date(row.created_at).toISOString(),
      // زر الإصدار بيتظهر بس للداعي نفسه على دعوة لسه معلّقة فعلاً (بالحالة المعروضة، مش
      // المخزّنة) وعضويتها مكتوبة — نفس شروط مسار الإصدار.
      can_reissue:
        states[position] === 'PENDING' &&
        row.invited_by === actor.userId &&
        row.membership_id !== null &&
        row.user_id !== null,
    })),
    next_cursor: rows.length > page.limit ? (items.at(-1)?.['id'] ?? null) : null,
  });
}
