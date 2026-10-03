import type { ReactNode } from 'react';
import { BrandLockup } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

export function AppFrame({
  brand,
  selector,
  actions,
  sidebar,
  children,
}: {
  brand: ReactNode;
  selector?: ReactNode;
  actions?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}) {
  const locale = useLocale();
  return (
    <div className={`flex min-h-dvh min-w-0 flex-col ${sidebar ? 'md:ms-72' : ''}`}>
      <header
        aria-label={typeof brand === 'string' ? brand : undefined}
        className="flex min-h-16 items-center gap-2 border-b border-border bg-card ps-4 pe-4 py-2 sm:ps-8 sm:pe-8"
      >
        {sidebar ?? (
          <BrandLockup
            title={t(locale, 'brand.title')}
            latinName={t(locale, 'brand.latinName')}
            arabicName={t(locale, 'brand.arabicName')}
          />
        )}
        <div className="ms-auto flex items-center gap-2">
          {selector}
          {actions}
        </div>
      </header>
      <main className="min-w-0 flex-1 ps-4 pe-4 py-8 sm:ps-8 sm:pe-8">{children}</main>
    </div>
  );
}
