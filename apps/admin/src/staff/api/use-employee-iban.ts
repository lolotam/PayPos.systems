'use client';
import {
  employeeIbanHistoryPage,
  employeeIbanView,
  type SetEmployeeIbanInput,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiClient } from '@/shared/api/client';

export function useEmployeeIban(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  cursor?: number,
) {
  const client = useQueryClient();
  const key = ['employee-iban', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const current = useCurrentIban(key, params);
  const history = useIbanHistory(
    key,
    params,
    cursor,
    current.isFetchedAfterMount && !current.isError && current.data?.can_read_full === true,
  );
  const save = useSaveIban(key, params);
  const accessDenied = [current.error, history.error, save.error].some((error) =>
    [403, 404].includes((error as { status?: number } | null)?.status ?? 0),
  );
  const removeSaves = useCallback(() => {
    const mutations = client.getMutationCache();
    const mutationKey = ['employee-iban', companyId, businessId, userId, employeeId, 'set'];
    for (const mutation of mutations.findAll({ mutationKey, exact: true }))
      mutations.remove(mutation);
  }, [client, companyId, businessId, userId, employeeId]);
  const clearCache = useCallback(() => {
    client.removeQueries({
      queryKey: ['employee-iban', companyId, businessId, userId, employeeId],
    });
    removeSaves();
  }, [client, removeSaves, companyId, businessId, userId, employeeId]);
  useEffect(() => clearCache, [clearCache]);
  useEffect(() => {
    if (accessDenied) clearCache();
  }, [clearCache, accessDenied]);
  // لو الصلاحية اتسحبت والقراءة رجعت مقنّعة، السجل الكامل وبيانات الحفظ القديمة لازم تتمسح من الكاش.
  const masked = current.isFetchedAfterMount && current.data?.can_read_full === false;
  const resetSave = save.reset;
  useEffect(() => {
    if (!masked) return;
    client.removeQueries({
      queryKey: ['employee-iban', companyId, businessId, userId, employeeId, 'history'],
    });
    removeSaves();
    resetSave();
  }, [masked, client, removeSaves, resetSave, companyId, businessId, userId, employeeId]);
  return { current, history, save, accessDenied };
}

type IbanParams = {
  header: { 'x-company-id': string };
  path: { businessId: string; employeeId: string };
};
function useCurrentIban(key: string[], params: IbanParams) {
  return useQuery({
    queryKey: [...key, 'current'],
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/iban',
        { params, signal },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeIbanView.parse(result.data);
    },
  });
}
function useIbanHistory(
  key: string[],
  params: IbanParams,
  cursor: number | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...key, 'history', cursor],
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    enabled,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/iban/history',
        {
          params: { ...params, query: { limit: 20, ...(cursor ? { cursor } : {}) } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeIbanHistoryPage.parse(result.data);
    },
  });
}
function useSaveIban(key: string[], params: IbanParams) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...key, 'set'],
    gcTime: 0,
    retry: false,
    mutationFn: async (body: SetEmployeeIbanInput) => {
      const result = await apiClient().PUT(
        '/v1/businesses/{businessId}/employees/{employeeId}/iban',
        { params, body },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeIbanView.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}
