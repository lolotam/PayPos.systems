'use client';

import type { PermissionMembership } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useState } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useCanEndMembership, useEndMembership } from '../api/use-end-membership';

type Props = {
  companyId: string;
  userId: string;
  membership: Pick<PermissionMembership, 'id' | 'ends_at'>;
};

export function EndMembershipSection({ membership, ...ids }: Props) {
  const canEnd = useCanEndMembership();
  if (!canEnd || membership.ends_at !== null) return null;
  return <EndMembershipControl {...ids} membershipId={membership.id} />;
}

function EndMembershipControl({
  companyId,
  userId,
  membershipId,
}: Omit<Props, 'membership'> & { membershipId: string }) {
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const end = useEndMembership(companyId, userId, membershipId);
  const refusal = end.isError ? (
    <p role="alert" className="text-sm text-destructive">
      {envelopeMessage(end.error, locale)}
    </p>
  ) : null;
  return (
    <section className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={end.isPending}
        onClick={() => setConfirmOpen(true)}
      >
        {t(locale, 'permissions.endMembership')}
      </Button>
      {confirmOpen ? (
        <ModalDialog
          title={t(locale, 'permissions.endMembershipTitle')}
          pending={end.isPending}
          onClose={() => setConfirmOpen(false)}
        >
          <p>{t(locale, 'permissions.endMembershipLead')}</p>
          {refusal}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={end.isPending}
              onClick={() => end.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })}
            >
              {t(locale, 'permissions.endMembershipConfirm')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={end.isPending}
              onClick={() => setConfirmOpen(false)}
            >
              {t(locale, 'permissions.endMembershipCancel')}
            </Button>
          </div>
        </ModalDialog>
      ) : (
        refusal
      )}
    </section>
  );
}
