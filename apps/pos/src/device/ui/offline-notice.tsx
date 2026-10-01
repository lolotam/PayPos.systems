import { t } from '@pospay/i18n';
import { Button, Card, CardContent, CardHeader } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function OfflineNotice({ onRetry }: { onRetry: () => Promise<void> }) {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <h1 className="text-start text-lg font-bold leading-tight">
            {t(locale, 'pos.offlineTitle')}
          </h1>
          <p className="text-start text-sm text-muted-foreground">{t(locale, 'pos.offlineLead')}</p>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => void onRetry()}>
            {t(locale, 'pos.retry')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
