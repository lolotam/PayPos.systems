'use client';

import { t } from '@pospay/i18n';
import { Card } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

/** تنبيه «الكشف لسه ما اتعملش»: الأرقام تحته حيّة من البنود، ومفيش كشف محفوظ لحد ما يتعمل. */
export function StatementNotGenerated() {
  const locale = useLocale();
  return (
    <Card className="flex flex-col gap-1 p-4">
      <p className="font-semibold">{t(locale, 'commissionStatementScreen.emptyTitle')}</p>
      <p className="text-muted-foreground">{t(locale, 'commissionStatementScreen.emptyBody')}</p>
    </Card>
  );
}
