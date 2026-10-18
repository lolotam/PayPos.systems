'use client';
import { useCallback, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeListControls } from '../../model/use-employee-list-controls';
import { companyNumbersEditMessage, companyNumbersListDenied } from '../model/company-employee-number-message';
import { useCompanyEmployeeNumbers, useSetCompanyEmployeeNumber } from './use-company-employee-numbers';

export function useCompanyNumbersScreen(companyId: string, userId: string) {
  const locale = useLocale();
  const [editingId, setEditingId] = useState<string>();
  const controls = useEmployeeListControls(useCallback(() => setEditingId(undefined), []));
  const list = useCompanyEmployeeNumbers(companyId, userId, controls.cursor, controls.q);
  const save = useSetCompanyEmployeeNumber(companyId, userId);
  const editing = list.data?.items.find((item) => item.employee_id === editingId);
  const onPage = (cursor: string | undefined) => {
    controls.onPage(cursor);
    setEditingId(undefined);
  };
  const onSubmit = (employeeNumber: number) => {
    if (!editing) return;
    save.mutate(
      { businessId: editing.business_id, employeeId: editing.employee_id, employeeNumber },
      { onSuccess: () => setEditingId(undefined) },
    );
  };
  return {
    text: controls.text,
    cursor: controls.cursor,
    onSearch: controls.onSearch,
    list,
    denied: companyNumbersListDenied(list.error),
    editingId,
    pending: save.isPending,
    message: save.isError ? companyNumbersEditMessage(save.error, locale) : null,
    onEdit: (employeeId: string) => {
      save.reset();
      setEditingId(employeeId);
    },
    onClose: () => {
      save.reset();
      setEditingId(undefined);
    },
    onPage,
    onSubmit,
  };
}
