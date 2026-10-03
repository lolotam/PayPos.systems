'use client';
import { salaryHistoryPage, employeeSalary, type SetSalaryInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  const history = useQuery({
    queryKey: [...queryKey, cursor],
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/salaries',
        { params: { ...params, query: { limit: 20, ...(cursor ? { cursor } : {}) } }, signal },
      );
      if (result.error) throw result.error;
      return salaryHistoryPage.parse(result.data);
    },
  });
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
