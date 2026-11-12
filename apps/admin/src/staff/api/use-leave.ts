'use client';
import { leavePage, leaveRequest, type RequestEmployeeLeaveInput } from '@pospay/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { leaveScopeKey } from './leave-query-scope';
type LeaveParams = {
  header: { 'x-company-id': string };
  path: { businessId: string; employeeId: string };
};
function useOpenLeave(
  params: LeaveParams,
  queryKey: string[],
  cursor: string | undefined,
  asOf: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...queryKey, 'open', cursor, asOf],
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/leave-requests',
        {
          params: {
            ...params,
            query: {
              limit: 20,
              open: 'true',
              ...(asOf ? { as_of: asOf } : {}),
              ...(cursor ? { cursor } : {}),
            },
          },
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
  cursor: string | undefined,
  asOf: string | undefined,
  enabled: boolean,
) {
  const queryKey = leaveScopeKey(companyId, businessId, userId, employeeId);
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const open = useOpenLeave(params, queryKey, cursor, asOf, enabled);
  const { save, cancel } = useLeaveMutations(params, queryKey);
  return { open, save, cancel };
}
