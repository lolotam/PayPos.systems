'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { alertRulesFailureMessage } from '../model/alert-rules-failure';

export function AlertRulesLoadError({
  error,
  refused,
  onRetry,
}: {
  error: unknown;
  refused: boolean;
  onRetry: () => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert">{alertRulesFailureMessage(error, locale)}</p>
      {/* إعادة المحاولة على رفض مش هتغيّر حاجة، فالزرار بيظهر مع الخطأ اللي مش رفض. */}
      {refused ? null : (
        <Button type="button" variant="outline" onClick={onRetry}>
          {t(locale, 'pos.retry')}
        </Button>
      )}
    </div>
  );
}
