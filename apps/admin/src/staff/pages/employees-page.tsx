'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader, PageShell } from '@pospay/ui';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployees } from '../api/use-employees';
import { useEmployeeListControls } from '../model/use-employee-list-controls';
import { EmployeeListPanel } from '../ui/employee-list-panel';
import { EmployeeNumberStartDialog } from '../ui/employee-number-start-dialog';
import { EmployeesHeaderActions } from '../ui/employees-header-actions';
import { EmployeeEditPanel } from '../ui/employee-edit-panel';
import { PasskeyEmployeesPanel } from '../ui/passkey-employees-panel';

export function EmployeesPage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusinessRead;
  userId: string;
}) {
  const locale = useLocale();
  const [employeeId, setEmployeeId] = useState('');
  const search = useEmployeeListControls(useCallback(() => setEmployeeId(''), []));
  const list = useEmployees(companyId, business.id, userId, search.cursor, search.q);
  const page = (next: string | undefined) => {
    search.onPage(next);
    setEmployeeId('');
  };
  return (
    <PageShell layout="list">
      <PageHeader
        title={t(locale, 'staff.listTitle')}
        description={t(locale, 'staff.listLead')}
        actions={
          <EmployeesHeaderActions companyId={companyId} userId={userId} businessId={business.id} />
        }
        action={
          <Button asChild>
            <Link href="/staff/create">{t(locale, 'staff.create')}</Link>
          </Button>
        }
      />
      <EmployeeNumberStartDialog companyId={companyId} userId={userId} />
      <EmployeeListPanel
        list={list}
        branches={business.branches}
        selectedId={employeeId}
        cursor={search.cursor}
        search={search.text}
        onSearch={search.onSearch}
        onSelect={setEmployeeId}
        onPage={page}
      />
      <PasskeyEmployeesPanel companyId={companyId} business={business} userId={userId} />
      {employeeId ? (
        <EmployeeEditPanel
          key={employeeId}
          companyId={companyId}
          business={business}
          userId={userId}
          employeeId={employeeId}
          onClose={() => setEmployeeId('')}
        />
      ) : null}
    </PageShell>
  );
}
