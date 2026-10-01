import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

export function LoadingNotice() {
  const locale = useLocale();
  return <p className="text-start text-sm text-muted-foreground">{t(locale, 'pos.loading')}</p>;
}
