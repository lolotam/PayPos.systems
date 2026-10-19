'use client';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';

export function CancelLineActions({
  locale,
  online,
  pending,
  onClose,
}: {
  locale: Locale;
  online: boolean;
  pending: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={!online || pending}>
        {pending
          ? t(locale, 'serviceLineCancel.submitting')
          : t(locale, 'serviceLineCancel.submit')}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!pending) onClose();
        }}
      >
        {t(locale, 'serviceLineCancel.close')}
      </Button>
    </div>
  );
}
