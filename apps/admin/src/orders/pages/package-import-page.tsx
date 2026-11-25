'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { PackageImportPanel } from '../ui/package-import-panel';

export function PackageImportPage({
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
      <PageHeader title={t(locale, 'packageImport.title')} />
      <PackageImportPanel companyId={companyId} businessId={business.id} userId={userId} />
    </PageShell>
  );
}
