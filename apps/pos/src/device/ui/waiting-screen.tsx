import { t } from '@pospay/i18n';
import { Button, BrandedPanel, Clock3 } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function WaitingScreen({
  checkCode,
  onStartOver,
}: {
  checkCode?: string;
  onStartOver: () => Promise<void>;
}) {
  const locale = useLocale();
  return (
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, 'pos.waitingTitle')}
      description={t(locale, 'pos.waitingLead')}
      icon={<Clock3 className="size-8 text-warning" />}
    >
      {checkCode ? (
        <div className="mb-6 flex flex-col gap-2 text-start">
          <p className="text-sm font-medium text-muted-foreground">
            {t(locale, 'pos.checkCodeLabel')}
          </p>
          <p
            data-testid="device-check-code"
            dir="ltr"
            className="font-mono text-4xl font-bold tracking-[0.3em] text-foreground"
          >
            {checkCode}
          </p>
          <p className="text-sm text-muted-foreground">{t(locale, 'pos.checkCodeHint')}</p>
        </div>
      ) : null}
      <Button size="touch" type="button" variant="outline" onClick={() => void onStartOver()}>
        {t(locale, 'pos.startOver')}
      </Button>
    </BrandedPanel>
  );
}
