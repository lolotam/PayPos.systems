'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeImportPanel } from '../ui/employee-import-panel';

export function EmployeeImportPage({
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
      <PageHeader title={t(locale, 'employeeImport.title')} />
      <EmployeeImportPanel companyId={companyId} businessId={business.id} userId={userId} />
    </PageShell>
  );
}
