'use client';
import type { EmployeeNumberListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useCallback, useEffect, useRef } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { displayEmployeeNumber } from '../../model/employee-number-display';
import { companyEmployeeNumberLabel } from '../model/company-employee-number-label';
import { CompanyEmployeeNumberEditor } from './company-employee-number-editor';

function editButtonName(locale: Locale, name: string) {
  return t(locale, 'companyEmployeeNumbers.editName').replace('{name}', name);
}

function useEditButtonFocus(employeeId: string, editingId: string | undefined) {
  const editButton = useRef<HTMLButtonElement>(null);
  const editorNode = useRef<HTMLFormElement | null>(null);
  const owned = useRef(false);
  const rootRef = useCallback((node: HTMLFormElement | null) => {
    if (node) editorNode.current = node;
  }, []);
  useEffect(() => {
    const active = document.activeElement;
    const insideEditor = editorNode.current?.contains(active) === true;
    // البحث والصفحة بياخدوا التركيز قبل الإغلاق؛ الرجوع للزر بس لو التركيز وقع مع إزالة المحرّر.
    if (owned.current && editingId === undefined && (active === document.body || insideEditor)) {
      editButton.current?.focus();
    }
    owned.current = editingId === employeeId;
    if (editingId !== employeeId) editorNode.current = null;
  }, [editingId, employeeId]);
  return { editButton, rootRef };
}

export function CompanyEmployeeNumberRow({
  item,
  editingId,
  pending,
  message,
  onEdit,
  onClose,
  onSubmit,
}: {
  item: EmployeeNumberListItem;
  editingId: string | undefined;
  pending: boolean;
  message: string | null;
  onEdit: (employeeId: string) => void;
  onClose: () => void;
  onSubmit: (employeeNumber: number) => void;
}) {
  const locale = useLocale();
  const editing = editingId === item.employee_id;
  const { editButton, rootRef } = useEditButtonFocus(item.employee_id, editingId);
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
              rootRef={rootRef}
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
