'use client';

import { t } from '@pospay/i18n';
import type { MemberInvitation } from '@pospay/contracts';
import { useLocale } from '@/shared/locale/locale-context';

type Props = {
  items: readonly MemberInvitation[];
  /** فيه صفحة تالية؟ */
  hasMore: boolean;
  onLoadMore: () => void;
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

type RowProps = {
  invitation: MemberInvitation;
  reissuePending: boolean;
  onReissue: (invitation: MemberInvitation) => void;
};

/** صف دعوة: الدور والنطاق بالترجمة، وزر الإصدار بس لو الـ API قال إن المتصل يقدر. */
function InvitationRow({ invitation, reissuePending, onReissue }: RowProps) {
  const locale = useLocale();
  const role = ROLE_KEY[invitation.role_code as keyof typeof ROLE_KEY];
  return (
    <tr className="border-b">
      <td className="p-2">{role === undefined ? invitation.role_code : t(locale, role)}</td>
      <td className="p-2">{t(locale, SCOPE_KEY[invitation.scope_type])}</td>
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
  );
}

/** رأس الجدول: الدور والنطاق والحالة ووقت الدعوة وعمود الإصدار. */
function InvitationsHead() {
  const locale = useLocale();
  return (
    <thead>
      <tr className="border-b text-start">
        <th scope="col" className="p-2 text-start">
          {t(locale, 'invitations.roleLabel')}
        </th>
        <th scope="col" className="p-2 text-start">
          {t(locale, 'invitations.scopeLabel')}
        </th>
        <th scope="col" className="p-2 text-start">
          {t(locale, 'permissions.effect')}
        </th>
        <th scope="col" className="p-2 text-start">
          {t(locale, 'invitations.invitedAt')}
        </th>
        <th scope="col" className="p-2 text-start" aria-label={t(locale, 'invitations.reissue')} />
      </tr>
    </thead>
  );
}

/** قائمة الدعوات: أدوار ونطاقات بالترجمة وحالة كل صف، وزر الإصدار بس لمن يستحقه من الـ API. */
export function InvitationsTable({
  items,
  hasMore,
  onLoadMore,
  loadingMore,
  reissuePending,
  onReissue,
}: Props) {
  const locale = useLocale();
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(locale, 'invitations.empty')}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full border-collapse text-start text-sm">
        <caption className="sr-only">{t(locale, 'invitations.listTitle')}</caption>
        <InvitationsHead />
        <tbody>
          {items.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              reissuePending={reissuePending}
              onReissue={onReissue}
            />
          ))}
        </tbody>
      </table>
      {hasMore ? (
        <button
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
          className="self-start rounded-md border border-border px-3 py-1 text-sm"
        >
          {t(locale, 'invitations.loadMore')}
        </button>
      ) : null}
    </div>
  );
}
