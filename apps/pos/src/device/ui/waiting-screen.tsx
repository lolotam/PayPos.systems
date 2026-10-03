import { t } from '@pospay/i18n';
import { Button, BrandedPanel, Clock3 } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function WaitingScreen({ onStartOver }: { onStartOver: () => Promise<void> }) {
  const locale = useLocale();
  return (
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, 'pos.waitingTitle')}
      description={t(locale, 'pos.waitingLead')}
      icon={<Clock3 className="size-8 text-warning" />}
    >
      <Button type="button" variant="outline" onClick={() => void onStartOver()}>
        {t(locale, 'pos.startOver')}
      </Button>
    </BrandedPanel>
  );
}
