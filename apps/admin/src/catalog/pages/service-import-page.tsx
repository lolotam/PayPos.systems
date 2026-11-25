'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ServiceImportPanel } from '../ui/service-import-panel';

export function ServiceImportPage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
}) {
  const locale = useLocale();
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'catalogServiceImport.title')} />
      <ServiceImportPanel companyId={companyId} businessId={business.id} userId={userId} />
    </PageShell>
  );
}
