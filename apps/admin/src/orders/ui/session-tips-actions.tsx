'use client';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';

export function SessionTipsActions({
  locale,
  online,
  pending,
  blocked,
  conflictHold,
  onClose,
  onRetry,
}: {
  locale: Locale;
  online: boolean;
  pending: boolean;
  blocked: boolean;
  conflictHold: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" disabled={!online || blocked}>
        {pending ? t(locale, 'sessionTips.saving') : t(locale, 'sessionTips.save')}
      </Button>
      {conflictHold ? (
        <Button type="button" variant="outline" disabled={pending} onClick={onRetry}>
          {t(locale, 'sessionTips.retry')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!pending) onClose();
        }}
      >
        {t(locale, 'sessionTips.close')}
      </Button>
    </div>
  );
}
