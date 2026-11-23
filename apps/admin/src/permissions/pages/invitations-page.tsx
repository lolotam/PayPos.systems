'use client';

import { t } from '@pospay/i18n';
import type { MemberInvitation } from '@pospay/contracts';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useState } from 'react';

import { useMemberInvitations } from '../api/use-member-invitations';
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

/** شاشة دعوة العضو (spec 076 G1): النموذج بتأكيد إجباري، والرابط مرة واحدة، والقائمة بلا أسرار. */
export function InvitationsPage({ companyId, userId, choices }: Props) {
  const locale = useLocale();
  const { query, invite, reissue } = useMemberInvitations(companyId, userId);
  const [shownLink, setShownLink] = useState<string | null>(null);
  const [existingNotice, setExistingNotice] = useState(false);
  const [reissuedNotice, setReissuedNotice] = useState(false);

  const onInvited = (result: { invitation_id: string; set_password_link: string | null }) => {
    setExistingNotice(result.set_password_link === null);
    setReissuedNotice(false);
    setShownLink(result.set_password_link);
  };
  const onReissue = (invitation: MemberInvitation) => {
    setReissuedNotice(false);
    reissue.mutate(invitation.id, {
      onSuccess: (result) => {
        setReissuedNotice(true);
        setShownLink(result.set_password_link);
      },
    });
  };

  return (
    <section className="flex min-w-0 flex-col gap-10 text-start">
      <div>
        <h1 className="text-2xl font-semibold">{t(locale, 'invitations.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'invitations.lead')}</p>
      </div>
      {shownLink !== null ? (
        <InvitationLinkOnce link={shownLink} onDismiss={() => setShownLink(null)} />
      ) : null}
      <InvitationNotices existing={existingNotice} reissued={reissuedNotice} />
      {invite.isError || reissue.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {envelopeMessage(invite.isError ? invite.error : reissue.error, locale)}
        </p>
      ) : null}
      <InvitationForm
        key={shownLink ?? 'form'}
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
            page={query.data}
            canReissue={(invitation) => invitation.state === 'PENDING'}
            reissuePending={reissue.isPending}
            onReissue={onReissue}
          />
        ) : null}
      </div>
    </section>
  );
}
