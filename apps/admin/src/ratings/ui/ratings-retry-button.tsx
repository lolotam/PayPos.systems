'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function RatingsRetryButton({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  const locale = useLocale();
  return (
    <Button type="button" variant="outline" disabled={busy} onClick={onRetry}>
      {t(locale, 'ratings.retry')}
    </Button>
  );
}
