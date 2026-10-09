'use client';
import { scheduleSettings, type SetScheduleSettingsInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { ScheduleWorkspace } from './use-schedules';

const settingsKey = (scope: ScheduleWorkspace) =>
  ['schedule-settings', scope.companyId, scope.businessId, scope.userId] as const;
const params = (scope: ScheduleWorkspace) => ({
  header: { 'x-company-id': scope.companyId },
  path: { businessId: scope.businessId },
});
export function useScheduleSettings(scope: ScheduleWorkspace) {
  return useQuery({
    queryKey: settingsKey(scope),
    retry: false,
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/schedule-settings', {
        params: params(scope),
        signal,
      });
      if (result.error) throw result.error;
      return scheduleSettings.parse(result.data);
    },
  });
}
export function useSetScheduleSettings(scope: ScheduleWorkspace) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...settingsKey(scope), 'save'],
    retry: false,
    mutationFn: async (input: SetScheduleSettingsInput) => {
      const result = await apiClient().PUT('/v1/businesses/{businessId}/schedule-settings', {
        params: params(scope),
        body: input,
      });
      if (result.error) throw result.error;
      return scheduleSettings.parse(result.data);
    },
    onMutate: () => ({
      companyId: scope.companyId,
      businessId: scope.businessId,
      key: settingsKey(scope),
    }),
    onSuccess: async (_data, _input, context) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: context.key }),
        client.invalidateQueries({
          queryKey: ['schedules', context.companyId, context.businessId],
        }),
        client.invalidateQueries({
          queryKey: ['shift-templates', context.companyId, context.businessId],
        }),
      ]);
    },
  });
}
