'use client';
import { employeeCard, employeeCardsView, type IssueEmployeeCardInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';

function retryAfterSeconds(response: Response | undefined): number | undefined {
  const header = response?.headers?.get?.('retry-after');
  if (!header || !/^\d+$/.test(header)) return undefined;
  const seconds = Number(header);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : undefined;
}

type CardPathParams = {
  header: { 'x-company-id': string };
  path: { businessId: string; employeeId: string };
};

// كارت الحضور النشط للموظف وإصداره/إلغاؤه؛ لا يُعاد الكود الكامل للواجهة.
export function useEmployeeCards(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  const queryKey = ['employee-cards', companyId, businessId, userId, employeeId];
  const params: CardPathParams = {
    header: { 'x-company-id': companyId },
    path: { businessId, employeeId },
  };
  const view = useCardsView(companyId, businessId, userId, employeeId);
  const issue = useIssueCard(queryKey, params);
  const revoke = useRevokeCard(queryKey, params);
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

function useIssueCard(queryKey: string[], params: CardPathParams) {
  const client = useQueryClient();
  return useMutation({
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
      if (result.error !== undefined || !result.response.ok) {
        const retryAfter = retryAfterSeconds(result.response);
        const body = typeof result.error === 'object' && result.error !== null ? result.error : {};
        throw {
          ...body,
          status: result.response.status,
          ...(retryAfter === undefined ? {} : { retryAfter }),
        };
      }
      return employeeCard.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
}

function useRevokeCard(queryKey: string[], params: CardPathParams) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...queryKey, 'revoke'],
    retry: false,
    mutationFn: async (cardId: string) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/cards/{cardId}/revoke',
        {
          params: {
            ...params,
            path: { ...params.path, cardId },
            header: { ...params.header, 'Idempotency-Key': crypto.randomUUID() },
          },
        },
      );
      if (result.error !== undefined || !result.response.ok) {
        throw result.error ?? { status: result.response.status };
      }
      return employeeCard.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
}

function useCardsView(companyId: string, businessId: string, userId: string, employeeId: string) {
  return useQuery({
    queryKey: ['employee-cards', companyId, businessId, userId, employeeId],
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/cards',
        {
          params: { header: { 'x-company-id': companyId }, path: { businessId, employeeId } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeCardsView.parse(result.data);
    },
  });
}
