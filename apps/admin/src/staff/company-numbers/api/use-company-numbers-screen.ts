'use client';
import { useCallback, useRef, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeListControls } from '../../model/use-employee-list-controls';
import { companyNumbersEditMessage, companyNumbersListDenied } from '../model/company-employee-number-message';
import { useCompanyEmployeeNumbers, useSetCompanyEmployeeNumber } from './use-company-employee-numbers';

export function useCompanyNumbersScreen(companyId: string, userId: string) {
  const locale = useLocale();
  const [editingId, setEditingId] = useState<string>();
  const save = useSetCompanyEmployeeNumber(companyId, userId);
  const saving = useRef(false);
  saving.current = save.isPending;
  const closeIfIdle = useCallback(() => {
    // البحث المستقر بيوصل بعد الكتابة؛ لو الحفظ لسه شغّال المحرّر يفضل مفتوح عشان النتيجة ما تختفيش.
    if (saving.current) return;
    setEditingId(undefined);
  }, []);
  const controls = useEmployeeListControls(closeIfIdle);
  const list = useCompanyEmployeeNumbers(companyId, userId, controls.cursor, controls.q);
  const editing = list.data?.items.find((item) => item.employee_id === editingId);
  const onPage = (cursor: string | undefined) => {
    if (save.isPending) return;
    controls.onPage(cursor);
    setEditingId(undefined);
  };
  const onSearch = (value: string) => {
    if (save.isPending) return;
    controls.onSearch(value);
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
    onSearch,
    list,
    denied: companyNumbersListDenied(list.error),
    editingId,
    pending: save.isPending,
    message: save.isError ? companyNumbersEditMessage(save.error, locale) : null,
    onEdit: (employeeId: string) => {
      // الحفظ الشغال ما يتسابش؛ reset بيمسح نتيجة الصف اللي اتبعت.
      if (save.isPending) return;
      save.reset();
      setEditingId(employeeId);
    },
    onClose: () => {
      if (save.isPending) return;
      save.reset();
      setEditingId(undefined);
    },
    onPage,
    onSubmit,
  };
}
