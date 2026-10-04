'use client';
import {
  employeePasskeyHistory,
  passkeyEmployeePage,
  unboundPasskey,
  type UnbindPasskeyInput,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';

export function useEmployeePasskeys(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  cursor?: string,
) {
  const client = useQueryClient();
  const key = ['employee-passkeys', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const history = usePasskeyHistory(companyId, businessId, userId, employeeId, cursor);
  const unbind = useMutation({
    mutationKey: [...key, 'unbind'],
    retry: false,
    mutationFn: async (body: UnbindPasskeyInput) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/passkeys/unbind',
        { params, body },
      );
      if (result.error) throw result.error;
      return unboundPasskey.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    onError: () => client.invalidateQueries({ queryKey: key }),
  });
  return { history, unbind };
}

function usePasskeyHistory(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  cursor?: string,
) {
  const client = useQueryClient();
  const key = ['employee-passkeys', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const history = useQuery({
    queryKey: [...key, cursor],
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/passkeys',
        {
          params: { ...params, query: { limit: 20, ...(cursor ? { cursor } : {}) } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeePasskeyHistory.parse(result.data);
    },
  });
  useEffect(
    () => () =>
      client.removeQueries({
        queryKey: ['employee-passkeys', companyId, businessId, userId, employeeId],
      }),
    [client, companyId, businessId, userId, employeeId],
  );
  useEffect(() => {
    const status = (history.error as { status?: number } | null)?.status;
    if (history.isError && (status === 403 || status === 404))
      client.removeQueries({
        queryKey: ['employee-passkeys', companyId, businessId, userId, employeeId],
      });
  }, [client, companyId, businessId, userId, employeeId, history.isError, history.error]);
  return history;
}

export function usePasskeyEmployees(
  companyId: string,
  businessId: string,
  userId: string,
  cursor?: string,
) {
  return useQuery({
    queryKey: ['passkey-employees', companyId, businessId, userId, cursor],
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/employee-passkeys', {
        params: {
          header: { 'x-company-id': companyId },
          path: { businessId },
          query: { limit: 20, ...(cursor ? { cursor } : {}) },
        },
        signal,
      });
      if (result.error) throw result.error;
      return passkeyEmployeePage.parse(result.data);
    },
  });
}
