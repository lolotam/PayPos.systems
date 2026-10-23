'use client';

import type { ReplaceStaffColumnsInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isStaffColumnsRefusal } from '../model/staff-columns-failure';
import { saveStaffColumns, staffColumnsKey } from './staff-columns-client';

export type SaveStaffColumnsInput = {
  idempotencyKey: string;
  body: ReplaceStaffColumnsInput;
};

export function useSaveStaffColumns(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  const key = staffColumnsKey(companyId, userId, businessId);
  return useMutation({
    retry: false,
    mutationFn: (input: SaveStaffColumnsInput) =>
      saveStaffColumns(companyId, businessId, input.idempotencyKey, input.body),
    onSuccess: (saved) => {
      client.setQueryData(key, saved);
    },
    onError: (error) => {
      // الرفض بالصلاحية ممكن يكون سحب صلاحية النشاط؛ القراءة بتتطلب من جديد عشان الشاشة تتحدث.
      if (!isStaffColumnsRefusal(error)) return;
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
