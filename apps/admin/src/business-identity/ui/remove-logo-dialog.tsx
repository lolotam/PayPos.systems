'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { identityFailureMessage } from '../model/identity-failure';

export function RemoveLogoDialog({
  pending,
  failure,
  onClose,
  onConfirm,
}: {
  pending: boolean;
  failure: unknown;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const locale = useLocale();
  return (
    <ModalDialog
      title={t(locale, 'businessIdentity.removeTitle')}
      pending={pending}
      onClose={onClose}
    >
      <p>{t(locale, 'businessIdentity.removeLead')}</p>
      {failure ? <p role="alert">{identityFailureMessage(failure, locale)}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={onConfirm}>
          {t(locale, 'businessIdentity.removeConfirm')}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          {t(locale, 'businessIdentity.cancel')}
        </Button>
      </div>
    </ModalDialog>
  );
}
