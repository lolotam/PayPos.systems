'use client';
import { salaryHistoryPage, employeeSalary, type SetSalaryInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';
export function useSalaries(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  cursor?: string,
) {
  const client = useQueryClient();
  const queryKey = ['salaries', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const history = useSalaryHistory(companyId, businessId, userId, employeeId, cursor);
  const save = useMutation({
    mutationKey: [...queryKey, 'set'],
    retry: false,
    mutationFn: async (body: SetSalaryInput) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/salaries',
        {
          params: {
            ...params,
            header: { ...params.header, 'Idempotency-Key': crypto.randomUUID() },
          },
          body,
        },
      );
      if (result.error) throw result.error;
      return employeeSalary.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  return { history, save };
}

function useSalaryHistory(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  cursor?: string,
) {
  const client = useQueryClient();
  const queryKey = ['salaries', companyId, businessId, userId, employeeId];
  const history = useQuery({
    queryKey: [...queryKey, cursor],
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/salaries',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, employeeId },
            query: { limit: 20, ...(cursor ? { cursor } : {}) },
          },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return salaryHistoryPage.parse(result.data);
    },
  });
  // النسخة القديمة لا تبقى بعد الإغلاق؛ حذف الاستعلام يلغي طلبه الجاري أيضاً.
  useEffect(() => {
    const key = ['salaries', companyId, businessId, userId, employeeId];
    return () => client.removeQueries({ queryKey: key });
  }, [client, companyId, businessId, userId, employeeId]);
  useEffect(() => {
    const status = (history.error as { status?: number } | null)?.status;
    if (history.isError && (status === 403 || status === 404)) {
      client.removeQueries({ queryKey: ['salaries', companyId, businessId, userId, employeeId] });
    }
  }, [client, companyId, businessId, userId, employeeId, history.isError, history.error]);
  return history;
}
