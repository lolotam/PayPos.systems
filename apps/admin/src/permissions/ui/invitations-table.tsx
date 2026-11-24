'use client';

import { t } from '@pospay/i18n';
import type { MemberInvitation } from '@pospay/contracts';
import { useLocale } from '@/shared/locale/locale-context';

type Props = {
  items: readonly MemberInvitation[];
  /** cursor الصفحة التالية؛ null يعني خلصت القائمة. */
  cursor: string | null;
  onLoadMore: (cursor: string) => void;
  loadingMore: boolean;
  reissuePending: boolean;
  onReissue: (invitation: MemberInvitation) => void;
};

const STATE_KEY = {
  PENDING: 'invitations.statePending',
  ACTIVE: 'invitations.stateActive',
  CANCELLED: 'invitations.stateCancelled',
} as const;

const ROLE_KEY = {
  general_manager: 'invitations.roleGeneralManager',
  business_manager: 'invitations.roleBusinessManager',
  branch_manager: 'invitations.roleBranchManager',
  accountant: 'invitations.roleAccountant',
} as const;

const SCOPE_KEY = {
  COMPANY: 'invitations.scopeCompany',
  BUSINESS: 'invitations.scopeBusiness',
  BRANCH: 'invitations.scopeBranch',
} as const;

/** قائمة الدعوات: أدوار ونطاقات بالترجمة وحالة كل صف، وزر الإصدار بس لمن يستحقه من الـ API. */
export function InvitationsTable({
  items,
  cursor,
  onLoadMore,
  loadingMore,
  reissuePending,
  onReissue,
}: Props) {
  const locale = useLocale();
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(locale, 'invitations.empty')}</p>;
  }
  const roleLabel = (code: string) =>
    code in ROLE_KEY ? t(locale, ROLE_KEY[code as keyof typeof ROLE_KEY]) : code;
  const scopeLabel = (scopeType: string) =>
    scopeType in SCOPE_KEY ? t(locale, SCOPE_KEY[scopeType as keyof typeof SCOPE_KEY]) : scopeType;
  return (
    <div className="flex flex-col gap-2">
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
          {items.map((invitation) => (
            <tr key={invitation.id} className="border-b">
              <td className="p-2">{roleLabel(invitation.role_code)}</td>
              <td className="p-2">{scopeLabel(invitation.scope_type)}</td>
              <td className="p-2">{t(locale, STATE_KEY[invitation.state])}</td>
              <td className="p-2">{new Date(invitation.created_at).toLocaleString(locale)}</td>
              <td className="p-2">
                {invitation.can_reissue ? (
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
      {cursor !== null ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={() => onLoadMore(cursor)}
          className="self-start rounded-md border border-border px-3 py-1 text-sm"
        >
          {t(locale, 'invitations.loadMore')}
        </button>
      ) : null}
    </div>
  );
}
