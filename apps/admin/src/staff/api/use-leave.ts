'use client';
import { leavePage, leaveRequest, type RequestEmployeeLeaveInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { apiClient } from '@/shared/api/client';
type LeaveParams = {
  header: { 'x-company-id': string };
  path: { businessId: string; employeeId: string };
};
function useLeaveHistory(params: LeaveParams, queryKey: string[], cursor?: string) {
  return useQuery({
    queryKey: [...queryKey, cursor],
    staleTime: 0,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests',
        {
          params: { ...params, query: { limit: 20, ...(cursor ? { cursor } : {}) } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return leavePage.parse(result.data);
    },
  });
}
function useLeaveMutations(params: LeaveParams, queryKey: string[]) {
  const client = useQueryClient();
  const save = useMutation({
    retry: false,
    mutationFn: async (body: RequestEmployeeLeaveInput) => {
      const { note, ...terms } = body;
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests',
        {
          params: {
            ...params,
            header: { ...params.header, 'Idempotency-Key': crypto.randomUUID() },
          },
          body: { ...terms, ...(note === undefined ? {} : { note }) },
        },
      );
      if (result.error) throw result.error;
      return leaveRequest.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  const cancel = useMutation({
    retry: false,
    mutationFn: async (input: { leaveId: string; revision: number }) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/cancel',
        {
          params: {
            path: { ...params.path, leaveId: input.leaveId },
            header: { ...params.header, 'Idempotency-Key': crypto.randomUUID() },
          },
          body: { expected_revision: input.revision },
        },
      );
      if (result.error) throw result.error;
      return leaveRequest.parse(result.data);
    },
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  return { save, cancel };
}
export function useLeave(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
  cursor?: string,
) {
  const client = useQueryClient();
  const queryKey = ['leave', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const history = useLeaveHistory(params, queryKey, cursor);
  const { save, cancel } = useLeaveMutations(params, queryKey);
  useEffect(() => {
    const key = ['leave', companyId, businessId, userId, employeeId];
    return () => client.removeQueries({ queryKey: key });
  }, [client, companyId, businessId, userId, employeeId]);
  useEffect(() => {
    const status = (history.error as { status?: number } | null)?.status;
    if (history.isError && (status === 403 || status === 404))
      client.removeQueries({ queryKey: ['leave', companyId, businessId, userId, employeeId] });
  }, [client, companyId, businessId, userId, employeeId, history.isError, history.error]);
  return { history, save, cancel };
}
