'use client';
import { scheduleGrid, staffSchedule, type SetScheduleInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export interface ScheduleWorkspace {
  companyId: string;
  businessId: string;
  branchId: string;
  userId: string;
}
const scheduleKey = (scope: ScheduleWorkspace) =>
  ['schedules', scope.companyId, scope.businessId, scope.branchId, scope.userId] as const;
async function loadWeek(
  scope: ScheduleWorkspace,
  week: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const result = await apiClient().GET(
    '/v1/businesses/{businessId}/branches/{branchId}/schedules',
    {
      params: {
        header: { 'x-company-id': scope.companyId },
        path: { businessId: scope.businessId, branchId: scope.branchId },
        query: { week_start: week, limit: 20, ...(cursor ? { cursor } : {}) },
      },
      signal,
    },
  );
  if (result.error) throw result.error;
  return scheduleGrid.parse(result.data);
}
async function saveWeek(scope: ScheduleWorkspace, employeeId: string, input: SetScheduleInput) {
  const result = await apiClient().PUT(
    '/v1/businesses/{businessId}/branches/{branchId}/schedules/{employeeId}',
    {
      params: {
        header: { 'x-company-id': scope.companyId },
        path: { businessId: scope.businessId, branchId: scope.branchId, employeeId },
      },
      body: {
        week_start: input.week_start,
        expected_revision: input.expected_revision,
        shifts: input.shifts,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    },
  );
  if (result.error) throw result.error;
  return staffSchedule.parse(result.data);
}
export function useScheduleWeek(scope: ScheduleWorkspace, week: string, cursor?: string) {
  return useQuery({
    queryKey: [...scheduleKey(scope), week, cursor],
    queryFn: ({ signal }) => loadWeek(scope, week, cursor, signal),
    enabled: Boolean(week),
    refetchInterval: 30_000,
  });
}
export function useScheduleSave(scope: ScheduleWorkspace, employeeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...scheduleKey(scope), employeeId, 'save'],
    mutationFn: (input: SetScheduleInput) => saveWeek(scope, employeeId, input),
    retry: false,
    onMutate: () => ({ key: scheduleKey(scope) }),
    onSuccess: (_data, _input, context) => client.invalidateQueries({ queryKey: context.key }),
  });
}
