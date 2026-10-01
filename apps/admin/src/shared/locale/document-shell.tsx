'use client';

import { DirectionProvider } from '@pospay/ui';
import { useEffect, useState, type ReactNode } from 'react';

import type { Locale } from '@pospay/i18n';

import { QueryProvider } from '../api/query-provider';
import { LocaleProvider } from './locale-context';

export function DocumentShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [current, setCurrent] = useState(locale);
  const dir = current === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = current;
    document.documentElement.dir = dir;
  }, [current, dir]);
  return (
    <LocaleProvider locale={current} setLocale={setCurrent}>
      <DirectionProvider dir={dir} className="min-h-dvh">
        <QueryProvider>{children}</QueryProvider>
      </DirectionProvider>
    </LocaleProvider>
  );
}
