'use client';

import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
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
    <PageShell layout="list">
      <PageHeader title={t(locale, 'importedRefunds.title')} />
      <ImportedRefundsSwitch companyId={companyId} userId={userId} businessId={businessId} />
    </PageShell>
  );
}
