'use client';
import type { EmployeeNumberListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useEffect, useRef } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { displayEmployeeNumber } from '../../model/employee-number-display';
import { companyEmployeeNumberLabel } from '../model/company-employee-number-label';
import { CompanyEmployeeNumberEditor } from './company-employee-number-editor';

function editButtonName(locale: Locale, name: string) {
  return t(locale, 'companyEmployeeNumbers.editName').replace('{name}', name);
}

function useEditButtonFocus(editing: boolean) {
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    // الزر مش موجود وهو مفتوح، فالتركيز يرجع له بعد الإغلاق عشان الكيبورد يكمّل من نفس الصف.
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  return editButton;
}

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
  const editButton = useEditButtonFocus(editing);
  const person = companyEmployeeNumberLabel(item, locale);
  const business = companyEmployeeNumberLabel(
    { name_ar: item.business_name_ar, name_en: item.business_name_en },
    locale,
  );
  return (
    <tr>
      <td>{person}</td>
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
            <Button
              ref={editButton}
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              aria-label={editButtonName(locale, person)}
              onClick={() => onEdit(item.employee_id)}
            >
              {t(locale, 'companyEmployeeNumbers.edit')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
