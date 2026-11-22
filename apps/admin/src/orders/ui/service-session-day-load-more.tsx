'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function ServiceSessionDayLoadMore({ onMore }: { onMore: () => Promise<unknown> }) {
  const locale = useLocale();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void onMore();
      }}
    >
      {t(locale, 'serviceLineEdit.loadMore')}
    </Button>
  );
}
