import { Button } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { leaveErrorText } from '../model/error-text';

export function LeaveReadRetry({
  error,
  retry,
}: {
  error: unknown;
  retry: () => Promise<unknown>;
}) {
  const locale = useLocale();
  return (
    <div>
      <p role="alert">{leaveErrorText(error, locale)}</p>
      <Button
        onClick={() => {
          void retry();
        }}
      >
        {t(locale, 'myLeave.retry')}
      </Button>
    </div>
  );
}
