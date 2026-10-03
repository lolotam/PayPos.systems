import type { ReactNode } from 'react';

import { BrandedPanel, BrandLockup } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { LocaleSwitch } from '@/shared/locale/locale-switch';

export function GuestFrame({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const locale = useLocale();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 ps-4 pe-4 py-12">
      <BrandedPanel
        brandTitle={t(locale, 'brand.title')}
        brand={
          <BrandLockup
            title={t(locale, 'brand.title')}
            latinName={t(locale, 'brand.latinName')}
            arabicName={t(locale, 'brand.arabicName')}
            className="mx-auto mb-4"
          />
        }
        title={title}
        description={lead}
        className="max-w-md"
      >
        {children}
      </BrandedPanel>
      <LocaleSwitch />
    </main>
  );
}
