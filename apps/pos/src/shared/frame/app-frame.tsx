import type { ReactNode } from 'react';
import { BrandLockup } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function AppFrame({
  brand,
  actions,
  children,
}: {
  brand: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const locale = useLocale();
  return (
    <div className="pos-shell flex min-h-dvh flex-col text-lg">
      <header
        aria-label={typeof brand === 'string' ? brand : undefined}
        className="flex flex-wrap items-center gap-2 border-b border-border bg-card ps-4 pe-4 py-4 sm:ps-8 sm:pe-8"
      >
        <BrandLockup
          title={t(locale, 'brand.title')}
          latinName={t(locale, 'brand.latinName')}
          arabicName={t(locale, 'brand.arabicName')}
        />
        <div className="ms-auto flex items-center gap-2">{actions}</div>
      </header>
      <main className="flex min-w-0 flex-1 flex-col justify-center ps-4 pe-4 py-12 sm:ps-8 sm:pe-8">
        {children}
      </main>
    </div>
  );
}
