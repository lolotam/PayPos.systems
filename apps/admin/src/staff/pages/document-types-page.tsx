'use client';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { DocumentTypesPanel } from '../ui/document-types-panel';

export function DocumentTypesPage({ companyId, userId }: { companyId: string; userId: string }) {
  const locale = useLocale();
  return (
    <PageShell layout="list">
      <PageHeader
        title={t(locale, 'employeeDocuments.typesTitle')}
        description={t(locale, 'employeeDocuments.typesLead')}
      />
      <DocumentTypesPanel companyId={companyId} userId={userId} />
    </PageShell>
  );
}
