'use client';

import { t } from '@pospay/i18n';

import { useLocale } from '@/shared/locale/locale-context';

export function NavStyleSaveAlert() {
  const locale = useLocale();
  return <p role="alert" className="m-4 text-sm text-destructive">{t(locale, 'adminNav.saveFailed')}</p>;
}
