'use client';
import type { WorkspaceBusiness } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Card } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { usePasskeyEmployees } from '../api/use-passkeys';
import { EmployeePasskeySection } from './employee-passkey-section';
import { EmployeePageNavigation } from './employee-page-navigation';
export function PasskeyEmployeesPanel({
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
  const [selected, setSelected] = useState<string>();
  const list = usePasskeyEmployees(companyId, business.id, userId, cursor);
  if (!list.isFetchedAfterMount || list.isError || !list.data || list.data.items.length === 0)
    return null;
  const employee = list.data.items.find((item) => item.id === selected);
  const timeZone =
    business.branches.find((branch) => branch.id === employee?.primary_branch_id)
      ?.effective_timezone ?? 'UTC';
  return (
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-xl font-bold">{t(locale, 'passkeyAdmin.employees')}</h2>
      <p>{t(locale, 'passkeyAdmin.lead')}</p>
      <ul className="flex flex-col gap-2">
        {list.data.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3">
            <span>{locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}</span>
            <Button
              variant="outline"
              aria-pressed={item.id === selected}
              onClick={() => setSelected(item.id)}
            >
              {t(locale, 'passkeyAdmin.select')}
            </Button>
          </li>
        ))}
      </ul>
      <EmployeePageNavigation
        cursor={cursor}
        next={list.data.next_cursor}
        onChange={(next) => {
          setSelected(undefined);
          setCursor(next);
        }}
      />
      {employee ? (
        <EmployeePasskeySection
          key={employee.id}
          companyId={companyId}
          businessId={business.id}
          userId={userId}
          employeeId={employee.id}
          timeZone={timeZone}
        />
      ) : null}
    </Card>
  );
}
