'use client';
import { employeeNumbering } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function employeeNumberingKey(companyId: string, userId: string) {
  return ['employee-numbering', companyId, userId] as const;
}

export function useEmployeeNumbering(companyId: string, userId: string) {
  return useQuery({
    queryKey: employeeNumberingKey(companyId, userId),
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/employee-numbering', {
        params: { header: { 'x-company-id': companyId } },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeNumbering.parse(result.data);
    },
  });
}

function startAlreadySet(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EMPLOYEE_NUMBER_START_ALREADY_SET'
  );
}

export function useSetEmployeeNumberStart(companyId: string, userId: string) {
  const client = useQueryClient();
  const key = employeeNumberingKey(companyId, userId);
  return useMutation({
    mutationKey: [...key, 'start'],
    retry: false,
    mutationFn: async (startNumber: number) => {
      const result = await apiClient().PUT('/v1/employee-numbering/start', {
        params: { header: { 'x-company-id': companyId } },
        body: { start_number: startNumber },
      });
      if (result.error) throw result.error;
      return employeeNumbering.parse(result.data);
    },
    onSuccess: (saved) => {
      client.setQueryData(key, saved);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error) => {
      if (!startAlreadySet(error)) return;
      void client.invalidateQueries({ queryKey: key });
    },
  });
}
