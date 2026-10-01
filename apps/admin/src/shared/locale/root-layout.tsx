import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { t } from '@pospay/i18n';

import { DocumentShell } from './document-shell';
import { readRequestLocale } from './request-locale';
import '@/styles/app.css';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await readRequestLocale();
  return { title: t(locale, 'admin.appName') };
}

export async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await readRequestLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <html lang={locale} dir={dir}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <DocumentShell locale={locale}>{children}</DocumentShell>
      </body>
    </html>
  );
}
