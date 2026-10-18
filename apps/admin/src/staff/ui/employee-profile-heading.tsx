'use client';
import type { EmployeeDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { displayEmployeeNumber } from '../model/employee-number-display';

export function EmployeeProfileHeading({ employee }: { employee: EmployeeDetail | undefined }) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-1 text-start">
      <h2 className="text-xl font-bold">{t(locale, 'staff.editTitle')}</h2>
      {employee ? (
        <p className="flex flex-wrap items-baseline gap-2">
          <span>{locale === 'ar' ? (employee.name_ar ?? employee.name_en) : employee.name_en}</span>
          <span>{displayEmployeeNumber(employee.employee_number)}</span>
        </p>
      ) : null}
    </div>
  );
}
