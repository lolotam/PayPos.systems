import { t } from '@pospay/i18n';
import { Button, Card, CardContent, CardHeader } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function WaitingScreen({ onStartOver }: { onStartOver: () => Promise<void> }) {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <h1 className="text-start text-lg font-bold leading-tight">
            {t(locale, 'pos.waitingTitle')}
          </h1>
          <p className="text-start text-sm text-muted-foreground">{t(locale, 'pos.waitingLead')}</p>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => void onStartOver()}>
            {t(locale, 'pos.startOver')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
