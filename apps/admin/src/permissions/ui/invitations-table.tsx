'use client';

import { t } from '@pospay/i18n';
import type { MemberInvitation } from '@pospay/contracts';
import { useLocale } from '@/shared/locale/locale-context';

type Props = {
  page: {
    readonly items: readonly MemberInvitation[];
    readonly next_cursor: string | null;
  };
  canReissue: (invitation: MemberInvitation) => boolean;
  reissuePending: boolean;
  onReissue: (invitation: MemberInvitation) => void;
};

const STATE_KEY = {
  PENDING: 'invitations.statePending',
  ACTIVE: 'invitations.stateActive',
  CANCELLED: 'invitations.stateCancelled',
} as const;

/** قائمة الدعوات: مفيش فيها رابط ولا توكن ولا إيميل صريح — الحالة والدور والنطاق والتاريخ بس. */
export function InvitationsTable({ page, canReissue, reissuePending, onReissue }: Props) {
  const locale = useLocale();
  if (page.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(locale, 'invitations.empty')}</p>;
  }
  return (
    <table className="w-full border-collapse text-start text-sm">
      <caption className="sr-only">{t(locale, 'invitations.listTitle')}</caption>
      <thead>
        <tr className="border-b text-start">
          <th scope="col" className="p-2 text-start">{t(locale, 'invitations.roleLabel')}</th>
          <th scope="col" className="p-2 text-start">{t(locale, 'invitations.scopeLabel')}</th>
          <th scope="col" className="p-2 text-start">{t(locale, 'permissions.effect')}</th>
          <th scope="col" className="p-2 text-start">{t(locale, 'invitations.invitedAt')}</th>
          <th scope="col" className="p-2 text-start" aria-label={t(locale, 'invitations.reissue')} />
        </tr>
      </thead>
      <tbody>
        {page.items.map((invitation) => (
          <tr key={invitation.id} className="border-b">
            <td className="p-2">{invitation.role_code}</td>
            <td className="p-2">{invitation.scope_type}</td>
            <td className="p-2">{t(locale, STATE_KEY[invitation.state])}</td>
            <td className="p-2">{new Date(invitation.created_at).toLocaleString(locale)}</td>
            <td className="p-2">
              {canReissue(invitation) ? (
                <button
                  type="button"
                  disabled={reissuePending}
                  onClick={() => onReissue(invitation)}
                  className="rounded-md border border-border px-3 py-1"
                >
                  {t(locale, 'invitations.reissue')}
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
