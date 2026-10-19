'use client';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';

export function SessionTipsActions({
  locale,
  online,
  pending,
  blocked,
  conflictHold,
  reloadHold,
  uncertain,
  onClose,
  onRetry,
  onReload,
  onReplay,
}: {
  locale: Locale;
  online: boolean;
  pending: boolean;
  blocked: boolean;
  conflictHold: boolean;
  reloadHold: boolean;
  uncertain: boolean;
  onClose: () => void;
  onRetry: () => void;
  onReload: () => void;
  onReplay: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {uncertain ? (
        <Button type="button" disabled={!online || blocked} onClick={onReplay}>
          {t(locale, 'sessionTips.retrySame')}
        </Button>
      ) : (
        <Button type="submit" disabled={!online || blocked}>
          {pending ? t(locale, 'sessionTips.saving') : t(locale, 'sessionTips.save')}
        </Button>
      )}
      {conflictHold ? (
        <Button type="button" variant="outline" disabled={pending} onClick={onRetry}>
          {t(locale, 'sessionTips.retry')}
        </Button>
      ) : null}
      {reloadHold ? (
        <Button type="button" variant="outline" disabled={pending} onClick={onReload}>
          {t(locale, 'sessionTips.reloadCurrent')}
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
