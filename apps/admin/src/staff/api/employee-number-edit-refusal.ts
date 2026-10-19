'use client';
import type { EmployeeDetail } from '@pospay/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

type NumberEditRefusal = {
  employee_number: number | null;
  primary_branch_id: string | null;
  branch_ids: readonly string[] | null;
};

function employeeNumberEditRefusedKey(companyId: string, employeeId: string) {
  return ['employee-number-edit-refused', companyId, employeeId] as const;
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

/** بيرفض تعديل رقم الموظف ده لحد ما تفاصيله ترجع برقم أو فروع مختلفة، أو الصفحة تتحمل من جديد. */
export function rememberEmployeeNumberEditRefusal(
  client: QueryClient,
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
): void {
  const detail = client.getQueryData<EmployeeDetail>(
    employeeDetailKey(companyId, businessId, userId, employeeId),
  );
  const mark = detail
    ? refusalFromDetail(detail)
    : { employee_number: null, primary_branch_id: null, branch_ids: null };
  client.setQueryData(employeeNumberEditRefusedKey(companyId, employeeId), mark);
}

function syncEmployeeNumberEditRefusal(
  client: QueryClient,
  companyId: string,
  employeeId: string,
  detail: EmployeeDetail,
): void {
  const key = employeeNumberEditRefusedKey(companyId, employeeId);
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
        if (sameKey(event.query.queryKey, employeeNumberEditRefusedKey(companyId, employeeId)))
          onStoreChange();
      }),
    [client, companyId, employeeId],
  );
  const refused = useSyncExternalStore(
    subscribe,
    () => client.getQueryData(employeeNumberEditRefusedKey(companyId, employeeId)) != null,
    () => false,
  );
  useEffect(() => {
    const detailKey = employeeDetailKey(companyId, businessId, userId, employeeId);
    const publish = () => {
      const detail = client.getQueryData<EmployeeDetail>(detailKey);
      if (detail) syncEmployeeNumberEditRefusal(client, companyId, employeeId, detail);
    };
    publish();
    return client.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && sameKey(event.query.queryKey, detailKey)) publish();
    });
  }, [client, companyId, businessId, userId, employeeId]);
  return refused;
}
