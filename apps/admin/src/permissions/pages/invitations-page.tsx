'use client';

import { t } from '@pospay/i18n';
import { readAccessProof } from '@/shared/api/read-access-proof';
import type { MemberInvitation } from '@pospay/contracts';
import { useState } from 'react';

import { fetchInvitationsPage, useMemberInvitations } from '../api/use-member-invitations';
import { useInvitationsAccess } from '../api/use-invitations-access';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { InvitationForm } from '../ui/invitation-form';
import type { InvitationScopeChoices } from '../model/invitable-roles';
import { InvitationLinkOnce } from '../ui/invitation-link-once';
import { InvitationNotices } from '../ui/invitation-notices';
import { InvitationsTable } from '../ui/invitations-table';

type Props = {
  companyId: string;
  userId: string;
  choices: InvitationScopeChoices;
};

/**
 * شاشة دعوة العضو (spec 076 G1): النموذج بتأكيد إجباري، والرابط بيتسلّم من نداء النداء
 * مباشرة لحالة محلية وبعدها النداء بيتصفّر — مفيش رابط في أي كاش ولا بيستخدم مفتاح.
 * البوابة مقفولة (503 NOT_READY) بتظهر رسالة بدل النموذج.
 */
export function InvitationsPage({ companyId, userId, choices }: Props) {
  const locale = useLocale();
  const { query, invite, reissue } = useMemberInvitations(companyId, userId);
  const [shownLink, setShownLink] = useState<string | null>(null);
  const [completedNotice, setCompletedNotice] = useState(false);
  const [reissuedNotice, setReissuedNotice] = useState(false);
  const [more, setMore] = useState<{ items: MemberInvitation[]; loading: boolean }>({
    items: [],
    loading: false,
  });
  // نفس قراءة الظهور: نجاحها معناه إن البوابة مفتوحة، و503 بيرجّع failed فبتظهر رسالة بدل النموذج.
  const access = useInvitationsAccess(companyId, userId, true);
  const gateOpen = readAccessProof(access) === 'granted';

  const onInvited = (result: { invitation_id: string; set_password_link: string | null }) => {
    setCompletedNotice(result.set_password_link === null);
    setReissuedNotice(false);
    setShownLink(result.set_password_link);
    invite.reset();
  };
  const onReissue = (invitation: MemberInvitation) => {
    setReissuedNotice(false);
    reissue.mutate(invitation.id, {
      onSuccess: (result) => {
        setReissuedNotice(true);
        setShownLink(result.set_password_link);
        reissue.reset();
      },
    });
  };
  const loadMore = async (cursor: string) => {
    setMore((current) => ({ ...current, loading: true }));
    const page = await fetchInvitationsPage(companyId, cursor);
    setMore((current) => ({ items: [...current.items, ...page.items], loading: false }));
  };

  return (
    <section className="flex min-w-0 flex-col gap-10 text-start">
      <div>
        <h1 className="text-2xl font-semibold">{t(locale, 'invitations.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'invitations.lead')}</p>
      </div>
      {gateOpen ? (
        <>
          {shownLink !== null ? (
            <InvitationLinkOnce link={shownLink} onDismiss={() => setShownLink(null)} />
          ) : null}
          <InvitationNotices existing={completedNotice} reissued={reissuedNotice} />
          {invite.isError || reissue.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {envelopeMessage(invite.isError ? invite.error : reissue.error, locale)}
            </p>
          ) : null}
          <InvitationForm
            companyId={companyId}
            choices={choices}
            disabled={false}
            pending={invite.isPending}
            onSave={(input) => invite.mutate(input, { onSuccess: onInvited })}
          />
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t(locale, 'invitations.listTitle')}</h2>
            {query.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
            {query.isError ? <p role="alert">{envelopeMessage(query.error, locale)}</p> : null}
            {query.data ? (
              <InvitationsTable
                items={[...query.data.items, ...more.items]}
                cursor={query.data.next_cursor}
                onLoadMore={loadMore}
                loadingMore={more.loading}
                reissuePending={reissue.isPending}
                onReissue={onReissue}
              />
            ) : null}
          </div>
        </>
      ) : (
        <p role="status">{t(locale, 'invitations.notReady')}</p>
      )}
    </section>
  );
}
