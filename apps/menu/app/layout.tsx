import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { THEME_BOOT_SCRIPT, THEME_COLOR_METAS } from '@pospay/ui/theme';
import './styles.css';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        {THEME_COLOR_METAS.map(({ media, content }) => (
          <meta key={media} name="theme-color" content={content} media={media} />
        ))}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
