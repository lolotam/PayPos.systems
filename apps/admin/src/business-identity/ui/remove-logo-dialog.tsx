'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';

export function RemoveLogoDialog({
  pending,
  onClose,
  onConfirm,
}: {
  pending: boolean;
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
