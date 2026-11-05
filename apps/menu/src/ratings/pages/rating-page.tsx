'use client';

import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useState } from 'react';
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
    <main lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <Button variant="ghost" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
        {t(locale, 'publicRating.language')}
      </Button>
      {link === null ? (
        <p role="status">{t(locale, 'publicRating.loading')}</p>
      ) : (
        <RatingSession key={link} token={link} locale={locale} />
      )}
    </main>
  );
}
