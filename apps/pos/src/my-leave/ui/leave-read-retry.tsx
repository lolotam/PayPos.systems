import { Button } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { leaveErrorText } from '../model/error-text';

export function LeaveReadRetry({
  error,
  retry,
  busy,
}: {
  error: unknown;
  retry: () => Promise<unknown>;
  busy: boolean;
}) {
  const locale = useLocale();
  return (
    <div>
      <p role="alert">{leaveErrorText(error, locale)}</p>
      {busy ? <p role="status">{t(locale, 'pos.loading')}</p> : null}
      <Button
        disabled={busy}
        onClick={() => {
          void retry();
        }}
      >
        {t(locale, 'myLeave.retry')}
      </Button>
    </div>
  );
}
