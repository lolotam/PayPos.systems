'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeImportPanel } from '../ui/employee-import-panel';

export function EmployeeImportPage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusiness;
  userId: string;
}) {
  const locale = useLocale();
  return (
    <section className="flex min-w-0 flex-col gap-12 text-start">
      <PageHeader
        title={t(locale, 'employeeImport.title')}
        description={t(locale, 'employeeImport.lead')}
      />
      <EmployeeImportPanel companyId={companyId} businessId={business.id} userId={userId} />
    </section>
  );
}
