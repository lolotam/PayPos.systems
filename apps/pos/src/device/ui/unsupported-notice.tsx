import { t } from '@pospay/i18n';
import { BrandedPanel, MonitorX } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function UnsupportedNotice() {
  const locale = useLocale();
  return (
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, 'pos.unsupportedTitle')}
      description={t(locale, 'pos.unsupportedLead')}
      icon={<MonitorX className="size-8 text-warning" />}
    />
  );
}
