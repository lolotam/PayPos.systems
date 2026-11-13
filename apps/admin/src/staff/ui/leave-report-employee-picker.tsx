'use client';
import type { EmployeeListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import { useMemo, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployees } from '../api/use-employees';

type Props = {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  onChange: (employeeId: string) => void;
};

function employeeLabel(locale: Locale, employee: EmployeeListItem): string {
  return locale === 'ar' ? (employee.name_ar ?? employee.name_en) : employee.name_en;
}

export function LeaveReportEmployeePicker({
  companyId,
  businessId,
  userId,
  employeeId,
  onChange,
}: Props) {
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<EmployeeListItem | undefined>(undefined);
  const term = search.trim();
  const list = useEmployees(
    companyId,
    businessId,
    userId,
    undefined,
    term === '' ? undefined : term,
  );
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const options = useMemo(
    () => (chosen && !items.some((item) => item.id === chosen.id) ? [chosen, ...items] : items),
    [chosen, items],
  );
  return (
    <div className="grid gap-2">
      <Label htmlFor="leave-report-employee-search">
        {t(locale, 'leaveHistory.reportSearchEmployee')}
      </Label>
      <Input
        id="leave-report-employee-search"
        type="search"
        maxLength={100}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Label htmlFor="leave-report-employee">{t(locale, 'leaveHistory.reportEmployee')}</Label>
      <NativeSelect
        id="leave-report-employee"
        value={employeeId}
        onChange={(event) => {
          const next = event.target.value;
          const picked = items.find((item) => item.id === next);
          if (picked) setChosen(picked);
          onChange(next);
        }}
      >
        <option value="">{t(locale, 'leaveHistory.reportAllEmployees')}</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {employeeLabel(locale, item)}
          </option>
        ))}
      </NativeSelect>
      {list.isError ? (
        <p role="status">{t(locale, 'leaveHistory.reportEmployeesUnavailable')}</p>
      ) : null}
    </div>
  );
}
