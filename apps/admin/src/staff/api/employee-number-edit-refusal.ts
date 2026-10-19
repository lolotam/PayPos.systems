'use client';
import type { EmployeeDetail } from '@pospay/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

type NumberEditRefusal = {
  employee_number: number | null;
  primary_branch_id: string | null;
  branch_ids: readonly string[] | null;
};

function employeeNumberEditRefusedKey(companyId: string, userId: string, employeeId: string) {
  return ['employee-number-edit-refused', companyId, userId, employeeId] as const;
}

function employeeDetailKey(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  return ['employees', companyId, businessId, userId, 'detail', employeeId] as const;
}

function sameKey(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

// الرقم والفروع الحالية هما اللي الرفض اتبنى عليهم؛ أي ترتيب لنفس الفروع نفس المرفق.
function attachmentFingerprint(mark: NumberEditRefusal): string | null {
  if (mark.primary_branch_id === null || mark.branch_ids === null) return null;
  const branches = [...mark.branch_ids].sort().join(',');
  return `${mark.employee_number ?? ''}|${mark.primary_branch_id}|${branches}`;
}

function refusalFromDetail(detail: EmployeeDetail): NumberEditRefusal {
  return {
    employee_number: detail.employee_number,
    primary_branch_id: detail.primary_branch_id,
    branch_ids: [...detail.branch_ids],
  };
}

/** بيرفض تعديل رقم الموظف ده لحد ما تفاصيله تتغير بعد آخر جلب، أو الصفحة تتحمل من جديد. */
export function rememberEmployeeNumberEditRefusal(
  client: QueryClient,
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
): void {
  // العلامة من غير مشترك، فوقت الجمع الافتراضي (خمس دقايق) كان بيمسحها والزرار يرجع.
  client.setQueryDefaults(['employee-number-edit-refused'], { gcTime: Infinity });
  // التفاصيل المخزنة وقت الرفض ممكن تكون قديمة؛ المرفق يتثبت لما الجلب الجديد يوصل.
  client.setQueryData(employeeNumberEditRefusedKey(companyId, userId, employeeId), {
    employee_number: null,
    primary_branch_id: null,
    branch_ids: null,
  });
  void client.invalidateQueries({
    queryKey: employeeDetailKey(companyId, businessId, userId, employeeId),
  });
}

function syncEmployeeNumberEditRefusal(
  client: QueryClient,
  companyId: string,
  userId: string,
  employeeId: string,
  detail: EmployeeDetail,
): void {
  const key = employeeNumberEditRefusedKey(companyId, userId, employeeId);
  const mark = client.getQueryData<NumberEditRefusal>(key);
  if (!mark) return;
  const saved = attachmentFingerprint(mark);
  const current = attachmentFingerprint(refusalFromDetail(detail));
  if (saved === null) {
    client.setQueryData(key, refusalFromDetail(detail));
    return;
  }
  if (saved !== current) client.removeQueries({ queryKey: key, exact: true });
}

function watchDetailBaseline(
  client: QueryClient,
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
): () => void {
  const detailKey = employeeDetailKey(companyId, businessId, userId, employeeId);
  let seenAt = -1;
  const publish = () => {
    const state = client.getQueryState<EmployeeDetail>(detailKey);
    // إبطال التفاصيل بيبعت تحديث قبل ما البيانات تتبدل؛ المرفق يتثبت على الجلب الجديد بس.
    if (!state?.data || state.dataUpdatedAt === seenAt) return;
    seenAt = state.dataUpdatedAt;
    syncEmployeeNumberEditRefusal(client, companyId, userId, employeeId, state.data);
  };
  publish();
  return client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && sameKey(event.query.queryKey, detailKey)) publish();
  });
}

/** علامة رفض التعديل للموظف ده، وبتتشال لما تفاصيله تتحدث برقم أو مرفقات مختلفة. */
export function useEmployeeNumberEditRefused(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
): boolean {
  const client = useQueryClient();
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client.getQueryCache().subscribe((event) => {
        if (
          sameKey(event.query.queryKey, employeeNumberEditRefusedKey(companyId, userId, employeeId))
        )
          onStoreChange();
      }),
    [client, companyId, userId, employeeId],
  );
  const refused = useSyncExternalStore(
    subscribe,
    () => client.getQueryData(employeeNumberEditRefusedKey(companyId, userId, employeeId)) != null,
    () => false,
  );
  useEffect(
    () => watchDetailBaseline(client, companyId, businessId, userId, employeeId),
    [client, companyId, businessId, userId, employeeId],
  );
  return refused;
}
