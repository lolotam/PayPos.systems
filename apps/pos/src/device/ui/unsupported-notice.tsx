import { t } from '@pospay/i18n';
import { Card, CardHeader } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function UnsupportedNotice() {
  const locale = useLocale();
  return (
    <div className="mx-auto w-full max-w-md">
      <Card>
        <CardHeader>
          <h1 className="text-start text-lg font-bold leading-tight">
            {t(locale, 'pos.unsupportedTitle')}
          </h1>
          <p className="text-start text-sm text-muted-foreground">
            {t(locale, 'pos.unsupportedLead')}
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}
