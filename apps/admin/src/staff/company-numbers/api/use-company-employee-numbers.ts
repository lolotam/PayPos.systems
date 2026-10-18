'use client';
import { employeeNumberPage, employeeNumberView, type EmployeeNumberPage } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

const listKey = (companyId: string, userId: string) =>
  ['employee-numbers', companyId, userId, 'list'] as const;

async function readPage(
  companyId: string,
  cursor: string | undefined,
  q: string | undefined,
  signal: AbortSignal,
) {
  const result = await apiClient().GET('/v1/employee-numbers', {
    params: {
      header: { 'x-company-id': companyId },
      query: { limit: 20, ...(cursor ? { cursor } : {}), ...(q ? { q } : {}) },
    },
    signal,
  });
  if (result.error) throw { ...result.error, status: result.response.status };
  return employeeNumberPage.parse(result.data);
}

async function writeNumber(
  companyId: string,
  businessId: string,
  employeeId: string,
  employeeNumber: number,
) {
  const result = await apiClient().PUT(
    '/v1/businesses/{businessId}/employees/{employeeId}/employee-number',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, employeeId } },
      body: { employee_number: employeeNumber },
    },
  );
  if (result.error) throw { ...result.error, status: result.response.status };
  return employeeNumberView.parse(result.data);
}

function withSavedNumber(page: EmployeeNumberPage, employeeId: string, employeeNumber: number) {
  return {
    ...page,
    items: page.items.map((item) =>
      item.employee_id === employeeId ? { ...item, employee_number: employeeNumber } : item,
    ),
  };
}

export function useCompanyEmployeeNumbers(
  companyId: string,
  userId: string,
  cursor?: string,
  q?: string,
) {
  // المفتاح يشمل المستخدم لأن المنع DENY بيتفلتر لكل صاحب صلاحية لوحده (PP-3.1).
  return useQuery({
    queryKey: [...listKey(companyId, userId), cursor ?? null, q ?? null],
    queryFn: ({ signal }) => readPage(companyId, cursor, q, signal),
    retry: false,
  });
}

export function useSetCompanyEmployeeNumber(companyId: string, userId: string) {
  const client = useQueryClient();
  const key = listKey(companyId, userId);
  return useMutation({
    retry: false,
    mutationFn: (input: { businessId: string; employeeId: string; employeeNumber: number }) =>
      writeNumber(companyId, input.businessId, input.employeeId, input.employeeNumber),
    onSuccess: (saved) => {
      client.setQueriesData<EmployeeNumberPage>({ queryKey: [...key] }, (page) =>
        page ? withSavedNumber(page, saved.employee_id, saved.employee_number) : page,
      );
      // انتظار الـ refetch كان بيخلّي الحفظ معلّق والمحرّر مفتوح لو القائمة اتعلّقت.
      void client.invalidateQueries({ queryKey: [...key] });
      void client.invalidateQueries({ queryKey: ['employees', companyId] });
    },
  });
}
