'use client';

import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { ImportedRefundsSwitch } from '../ui/imported-refunds-switch';

export function ImportedRefundsPage({
  companyId,
  userId,
  businessId,
}: {
  companyId: string;
  userId: string;
  businessId: string;
}) {
  const locale = useLocale();
  return (
    <section className="grid gap-4 text-start">
      <h1 className="text-lg font-semibold">{t(locale, 'importedRefunds.title')}</h1>
      <ImportedRefundsSwitch companyId={companyId} userId={userId} businessId={businessId} />
    </section>
  );
}
