'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployees } from '../api/use-employees';
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
  const [cursor, setCursor] = useState<string>();
  const [employeeId, setEmployeeId] = useState('');
  const list = useEmployees(companyId, business.id, userId, cursor);
  const page = (next: string | undefined) => {
    setCursor(next);
    setEmployeeId('');
  };
  return (
    <section className="flex min-w-0 flex-col gap-12 text-start">
      <PageHeader
        title={t(locale, 'staff.listTitle')}
        description={t(locale, 'staff.listLead')}
        action={
          <Button asChild>
            <Link href="/staff/create">{t(locale, 'staff.create')}</Link>
          </Button>
        }
      />
      <EmployeeListPanel
        list={list}
        branches={business.branches}
        selectedId={employeeId}
        cursor={cursor}
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
