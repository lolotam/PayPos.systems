'use client';

import { t, type Locale } from '@pospay/i18n';
import { Button, Languages } from '@pospay/ui';
import { useEffect, useState } from 'react';
import { RatingNotice } from '../ui/rating-notice';
import { RatingSession } from './rating-session';

export function RatingPage() {
  const [link, setLink] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>('ar');
  useEffect(() => {
    const read = () => {
      setLink(window.location.hash.slice(1));
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  return (
    <main
      lang={locale}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="mx-auto flex min-h-dvh max-w-lg flex-col gap-4 ps-4 pe-4 py-8"
    >
      <Button
        variant="ghost"
        className="self-end"
        onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
      >
        <Languages aria-hidden="true" />
        {t(locale, 'publicRating.language')}
      </Button>
      {link === null ? (
        <RatingNotice tone="loading">{t(locale, 'publicRating.loading')}</RatingNotice>
      ) : (
        <RatingSession key={link} token={link} locale={locale} />
      )}
    </main>
  );
}
