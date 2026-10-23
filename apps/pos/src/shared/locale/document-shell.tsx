import { t, type Locale } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { useEffect, useState, type ReactNode } from 'react';

import { isNativeShell } from '@/shared/platform/native-shell';

import { QueryProvider } from '../api/query-provider';
import { deviceLocale } from './device-locale';
import { LocaleProvider } from './locale-context';
import { readStoredLocale, writeStoredLocale } from './locale-storage';

export function DocumentShell({ children }: { children: ReactNode }) {
  // نسخة التطبيق بتاخد لغة التليفون أول مرة (FR-015)، ونسخة الويب بتفضل عربي زي ما هي.
  const [locale, setLocale] = useState(() =>
    readStoredLocale(isNativeShell() ? deviceLocale() : 'ar'),
  );
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
    document.title = t(locale, 'pos.appName');
  }, [locale, dir]);
  const change = (next: Locale): void => {
    writeStoredLocale(next);
    setLocale(next);
  };
  return (
    <LocaleProvider locale={locale} setLocale={change}>
      <DirectionProvider dir={dir} className="min-h-dvh">
        <QueryProvider>{children}</QueryProvider>
      </DirectionProvider>
    </LocaleProvider>
  );
}
