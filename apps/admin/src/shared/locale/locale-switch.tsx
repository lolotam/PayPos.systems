'use client';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRouter } from 'next/navigation';

import { writeLocaleCookie } from './locale-cookie';
import { useLocaleController } from './locale-context';

export function LocaleSwitch() {
  const router = useRouter();
  const { locale, setLocale } = useLocaleController();
  const next = locale === 'ar' ? 'en' : 'ar';
  const label = t(locale, next === 'ar' ? 'admin.languageArabic' : 'admin.languageEnglish');
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        writeLocaleCookie(next);
        setLocale(next);
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
