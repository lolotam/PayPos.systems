'use client';

import type { PermissionMembership } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useState } from 'react';

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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (membership.ends_at === null) return;
    const target = Date.parse(membership.ends_at);
    if (Number.isNaN(target) || target <= now) return;
    const delay = Math.min(Math.max(0, target - Date.now()), 2 ** 31 - 1);
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [membership.ends_at, now]);
  // تاريخ نهاية في المستقبل معناها العضوية لسه شغالة، فالإجراء متاح؛ ونهاية في الماضي معناها خلص.
  const alreadyEnded = membership.ends_at !== null && Date.parse(membership.ends_at) <= now;
  if (!canEnd || alreadyEnded) return null;
  return (
    <EndMembershipControl
      {...ids}
      membershipId={membership.id}
      onEnded={() => setNow(Date.now())}
    />
  );
}

function EndMembershipControl({
  companyId,
  userId,
  membershipId,
  onEnded,
}: Omit<Props, 'membership'> & { membershipId: string; onEnded: () => void }) {
  const locale = useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const end = useEndMembership(companyId, userId, membershipId);
  const refusal = end.isError ? (
    <p role="alert" className="text-sm text-destructive">
      {envelopeMessage(end.error, locale)}
    </p>
  ) : null;
  const confirm = () =>
    end.mutate(undefined, {
      onSuccess: () => {
        onEnded();
        setConfirmOpen(false);
      },
    });
  return (
    <section className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={end.isPending}
        onClick={() => {
          // فتح تاني بعد رفض قديم لازم يمسح الرسالة القديمة، عشان المستخدم ما يشوفش رفضاً مش تخصه.
          end.reset();
          setConfirmOpen(true);
        }}
      >
        {t(locale, 'permissions.endMembership')}
      </Button>
      {confirmOpen ? (
        <EndMembershipConfirmDialog
          pending={end.isPending}
          refusal={refusal}
          onConfirm={confirm}
          onClose={() => setConfirmOpen(false)}
        />
      ) : (
        refusal
      )}
    </section>
  );
}

function EndMembershipConfirmDialog({
  pending,
  refusal,
  onConfirm,
  onClose,
}: {
  pending: boolean;
  refusal: React.ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const locale = useLocale();
  return (
    <ModalDialog
      title={t(locale, 'permissions.endMembershipTitle')}
      pending={pending}
      onClose={onClose}
    >
      <p>{t(locale, 'permissions.endMembershipLead')}</p>
      {refusal}
      <div className="flex gap-2">
        <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
          {t(locale, 'permissions.endMembershipConfirm')}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          {t(locale, 'permissions.endMembershipCancel')}
        </Button>
      </div>
    </ModalDialog>
  );
}
