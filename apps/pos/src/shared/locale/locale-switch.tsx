import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocaleController } from './locale-context';

export function LocaleSwitch() {
  const { locale, setLocale } = useLocaleController();
  const next = locale === 'ar' ? 'en' : 'ar';
  const label = t(locale, next === 'ar' ? 'pos.languageArabic' : 'pos.languageEnglish');
  return (
    <Button size="touch" type="button" variant="outline" onClick={() => setLocale(next)}>
      {label}
    </Button>
  );
}
