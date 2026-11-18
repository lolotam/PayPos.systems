'use client';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { SessionServiceScope } from '../api/use-session-services';
import { PackageSaleForm } from '../ui/package-sale-form';

export function PackageSalePage({ scope }: { scope: SessionServiceScope }) {
  const locale = useLocale();
  return (
    <section className="grid gap-4 text-start">
      <PageHeader title={t(locale, 'packageSale.title')} />
      <PackageSaleForm scope={scope} />
    </section>
  );
}
