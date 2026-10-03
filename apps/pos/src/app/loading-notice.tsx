import { t } from '@pospay/i18n';
import { BrandedPanel, LoaderCircle } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

export function LoadingNotice() {
  const locale = useLocale();
  return (
    <BrandedPanel
      brandTitle={t(locale, 'brand.title')}
      title={t(locale, 'pos.loading')}
      icon={<LoaderCircle className="size-6 text-muted-foreground" />}
      role="status"
    />
  );
}
