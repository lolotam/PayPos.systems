'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployees } from '../api/use-employees';
import { useEmployeeListControls } from '../model/use-employee-list-controls';
import { EmployeeListPanel } from '../ui/employee-list-panel';
import { EmployeeEditPanel } from '../ui/employee-edit-panel';
import { PasskeyEmployeesPanel } from '../ui/passkey-employees-panel';

export function EmployeesPage({
  companyId,
  business,
  userId,
}: {
  companyId: string;
  business: WorkspaceBusiness;
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
    <section className="flex min-w-0 flex-col gap-12 text-start">
      <PageHeader
        title={t(locale, 'staff.listTitle')}
        description={t(locale, 'staff.listLead')}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/staff/document-types">{t(locale, 'employeeDocuments.typesLink')}</Link>
            </Button>
            <Button asChild>
              <Link href="/staff/create">{t(locale, 'staff.create')}</Link>
            </Button>
          </div>
        }
      />
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
    </section>
  );
}
