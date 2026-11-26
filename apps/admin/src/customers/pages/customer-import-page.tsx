'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { CustomerImportPanel } from '../ui/customer-import-panel';

type CustomerImportPageProps = {
  companyId: string;
  business: WorkspaceBusinessRead;
  branchId?: string;
  userId: string;
};

/** صفحة استيراد العملاء: العنوان في الترويسة ولوحة الاستيراد في الجسم. */
export function CustomerImportPage({
  companyId,
  business,
  branchId,
  userId,
}: CustomerImportPageProps) {
  const locale = useLocale();
  return (
    <PageShell layout="form">
      <PageHeader title={t(locale, 'customerImport.title')} />
      <CustomerImportPanel
        scope={{ companyId, businessId: business.id, ...(branchId ? { branchId } : {}), userId }}
      />
    </PageShell>
  );
}
