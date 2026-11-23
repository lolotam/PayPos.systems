'use client';
import { t } from '@pospay/i18n';
import { PageHeader, PageShell } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { EmployeeListSearch } from '../../ui/employee-list-search';
import { useCompanyNumbersScreen } from '../api/use-company-numbers-screen';
import { CompanyEmployeeNumbersPanel } from '../ui/company-employee-numbers-panel';

export function CompanyEmployeeNumbersPage({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  const locale = useLocale();
  const screen = useCompanyNumbersScreen(companyId, userId);
  return (
    <PageShell layout="list">
      <PageHeader
        title={t(locale, 'companyEmployeeNumbers.title')}
        description={t(locale, 'companyEmployeeNumbers.lead')}
      />
      <CompanyEmployeeNumbersPanel
        list={screen.list}
        filter={
          screen.denied ? null : (
            <EmployeeListSearch
              value={screen.text}
              onChange={screen.onSearch}
              disabled={screen.pending}
            />
          )
        }
        cursor={screen.cursor}
        editingId={screen.editingId}
        pending={screen.pending}
        message={screen.message}
        onEdit={screen.onEdit}
        onClose={screen.onClose}
        onPage={screen.onPage}
        onSubmit={screen.onSubmit}
      />
    </PageShell>
  );
}
