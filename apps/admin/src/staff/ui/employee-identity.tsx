'use client';
import type { EmployeeDetail } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { displayEmployeeNumber } from '../model/employee-number-display';

/** اسم الموظف ورقمه تحت العنوان؛ نص «رقم الموظف» لقارئ الشاشة فقط كما كان في اللوحة. */
export function EmployeeIdentity({ employee }: { employee: EmployeeDetail }) {
  const locale = useLocale();
  return (
    <>
      <span>{locale === 'ar' ? (employee.name_ar ?? employee.name_en) : employee.name_en}</span>
      <span className="ms-2">
        <span className="sr-only">{t(locale, 'staff.employeeNumber')} </span>
        {displayEmployeeNumber(employee.employee_number)}
      </span>
    </>
  );
}
