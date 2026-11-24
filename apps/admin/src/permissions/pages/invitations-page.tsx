'use client';

import { t } from '@pospay/i18n';
import type { InviteMemberInput, MemberInvitation } from '@pospay/contracts';
import { useState } from 'react';

import { useMemberInvitations } from '../api/use-member-invitations';
import { useInvitationsAccess } from '../api/use-invitations-access';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useLocale } from '@/shared/locale/locale-context';
import { InvitationForm } from '../ui/invitation-form';
import type { InvitationScopeChoices } from '../model/invitable-roles';
import { InvitationHandoff } from '../ui/invitation-handoff';
import { InvitationsListSection } from '../ui/invitations-list-section';

type Props = {
  companyId: string;
  userId: string;
  choices: InvitationScopeChoices;
};

/**
 * شاشة دعوة العضو (spec 076 G1): النموذج بتأكيد إجباري، والرابط بيتسلّم من النداء المباشر
 * لحالة محلية — مفيش useMutation، فالإيميل والرابط مش في أي كاش ولا مفتاح React.
 * البوابة مقفولة (503 NOT_READY) بتظهر رسالة بدل النموذج.
 */
export function InvitationsPage({ companyId, userId, choices }: Props) {
  const locale = useLocale();
  const { list, invite, reissue } = useMemberInvitations(companyId, userId);
  const [shownLink, setShownLink] = useState<string | null>(null);
  const [reissued, setReissued] = useState(false);
  const access = useInvitationsAccess(companyId, userId, true);
  const gateOpen = readAccessProof(access) === 'granted';

  const showLink = (link: string, wasReissued: boolean) => {
    setReissued(wasReissued);
    setShownLink(link);
  };
  const onReissue = async (invitation: MemberInvitation) => {
    setShownLink(null);
    const result = await reissue.run(invitation.id);
    if (result !== null) showLink(result.set_password_link, true);
  };
  const onInvite = async (input: InviteMemberInput) => {
    setShownLink(null);
    const result = await invite.run(input);
    if (result !== null) showLink(result.set_password_link, false);
  };

  return (
    <section className="flex min-w-0 flex-col gap-10 text-start">
      <div>
        <h1 className="text-2xl font-semibold">{t(locale, 'invitations.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, 'invitations.lead')}</p>
      </div>
      {gateOpen ? (
        <>
          <InvitationHandoff
            link={shownLink}
            reissued={reissued}
            error={invite.error ?? reissue.error}
            onDismiss={() => setShownLink(null)}
          />
          <InvitationForm
            companyId={companyId}
            choices={choices}
            disabled={false}
            pending={invite.pending}
            onSave={(input) => void onInvite(input)}
          />
          <InvitationsListSection
            list={list}
            reissuePending={reissue.pending}
            onReissue={(invitation) => void onReissue(invitation)}
          />
        </>
      ) : (
        <p role="status">{t(locale, 'invitations.notReady')}</p>
      )}
    </section>
  );
}
