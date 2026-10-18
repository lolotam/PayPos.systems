'use client';
import type { EmployeeNumberListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { displayEmployeeNumber } from '../../model/employee-number-display';
import { companyEmployeeNumberLabel } from '../model/company-employee-number-label';
import { CompanyEmployeeNumberEditor } from './company-employee-number-editor';

export function CompanyEmployeeNumberRow({
  item,
  editing,
  pending,
  message,
  onEdit,
  onClose,
  onSubmit,
}: {
  item: EmployeeNumberListItem;
  editing: boolean;
  pending: boolean;
  message: string | null;
  onEdit: (employeeId: string) => void;
  onClose: () => void;
  onSubmit: (employeeNumber: number) => void;
}) {
  const locale = useLocale();
  const business = companyEmployeeNumberLabel(
    { name_ar: item.business_name_ar, name_en: item.business_name_en },
    locale,
  );
  return (
    <tr>
      <td>{companyEmployeeNumberLabel(item, locale)}</td>
      <td>{business}</td>
      <td>
        <div className="flex flex-col items-start gap-2">
          <span>{displayEmployeeNumber(item.employee_number)}</span>
          {editing ? (
            <CompanyEmployeeNumberEditor
              current={item.employee_number}
              pending={pending}
              message={message}
              onSubmit={onSubmit}
              onClose={onClose}
            />
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(item.employee_id)}>
              {t(locale, 'companyEmployeeNumbers.edit')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
