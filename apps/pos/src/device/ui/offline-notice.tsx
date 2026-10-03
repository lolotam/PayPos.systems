import { t } from '@pospay/i18n';
import { Button, BrandedPanel, WifiOff } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function OfflineNotice({ onRetry }: { onRetry: () => Promise<void> }) {
  const locale = useLocale();
  return (
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, 'pos.offlineTitle')}
      description={t(locale, 'pos.offlineLead')}
      icon={<WifiOff className="size-8 text-warning" />}
    >
      <Button size="touch" type="button" onClick={() => void onRetry()}>
        {t(locale, 'pos.retry')}
      </Button>
    </BrandedPanel>
  );
}
