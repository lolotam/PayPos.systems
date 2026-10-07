'use client';
import { employeeCard, employeeCardsView, type IssueEmployeeCardInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';

// كارت الحضور النشط للموظف وإصداره/إلغاؤه؛ لا يُعاد الكود الكامل للواجهة.
export function useEmployeeCards(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  const queryKey = ['employee-cards', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const view = useCardsView(companyId, businessId, userId, employeeId);
  const issue = useMutation({
    mutationKey: [...queryKey, 'issue'],
    retry: false,
    mutationFn: async (body: IssueEmployeeCardInput) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/cards',
        {
          params: {
            ...params,
            header: { ...params.header, 'Idempotency-Key': crypto.randomUUID() },
          },
          body,
        },
      );
      if (result.error) throw result.error;
      return employeeCard.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  const revoke = useMutation({
    mutationKey: [...queryKey, 'revoke'],
    retry: false,
    mutationFn: async (cardId: string) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/cards/{cardId}/revoke',
        {
          params: {
            ...params,
            path: { businessId, employeeId, cardId },
            header: { ...params.header, 'Idempotency-Key': crypto.randomUUID() },
          },
        },
      );
      if (result.error) throw result.error;
      return employeeCard.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  // النسخة القديمة لا تبقى بعد إغلاق الموظف.
  useEffect(
    () => () =>
      client.removeQueries({
        queryKey: ['employee-cards', companyId, businessId, userId, employeeId],
      }),
    [client, companyId, businessId, userId, employeeId],
  );
  return { view, issue, revoke };
}

function useCardsView(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  return useQuery({
    queryKey: ['employee-cards', companyId, businessId, userId, employeeId],
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/cards',
        { params: { header: { 'x-company-id': companyId }, path: { businessId, employeeId } }, signal },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeCardsView.parse(result.data);
    },
  });
}
