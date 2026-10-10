'use client';
import {
  scheduleSettings,
  branchScheduleSettings,
  setScheduleSettingsInput,
  type MyWorkspacesResponse,
  type ScheduleSettings,
  type SetScheduleSettingsInput,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import type { ScheduleWorkspace } from './use-schedules';

const settingsKey = (scope: ScheduleWorkspace) =>
  ['schedule-settings', scope.companyId, scope.businessId, scope.userId] as const;
const params = (scope: ScheduleWorkspace) => ({
  header: { 'x-company-id': scope.companyId },
  path: { businessId: scope.businessId },
});
export function useScheduleWorkspaceBranches(scope: ScheduleWorkspace) {
  const workspace = useQuery<MyWorkspacesResponse>({
    queryKey: ['me', 'workspaces'],
    enabled: false,
  });
  return (
    workspace.data?.companies
      .find((c) => c.id === scope.companyId)
      ?.businesses.find((b) => b.id === scope.businessId)?.branches ?? []
  );
}
function useBranchSettingsMutation(scope: ScheduleWorkspace, clear: boolean) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: [...settingsKey(scope), scope.branchId, clear ? 'clear' : 'save'],
    retry: false,
    mutationFn: async (input: SetScheduleSettingsInput | undefined) => {
      const options = {
        params: {
          header: { 'x-company-id': scope.companyId },
          path: { businessId: scope.businessId, branchId: scope.branchId },
        },
      };
      const result = clear
        ? await apiClient().DELETE(
            '/v1/businesses/{businessId}/branches/{branchId}/schedule-settings',
            options,
          )
        : await apiClient().PUT(
            '/v1/businesses/{businessId}/branches/{branchId}/schedule-settings',
            { ...options, body: setScheduleSettingsInput.parse(input) },
          );
      if (result.error) throw result.error;
      return branchScheduleSettings.parse(result.data);
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
export function useSetBranchScheduleSettings(scope: ScheduleWorkspace) {
  return useBranchSettingsMutation(scope, false);
}
export function useClearBranchScheduleSettings(scope: ScheduleWorkspace) {
  const mutation = useBranchSettingsMutation(scope, true);
  return { ...mutation, mutateAsync: () => mutation.mutateAsync(undefined) };
}
export function useScheduleSettings(scope: ScheduleWorkspace) {
  return useQuery<ScheduleSettings>({
    queryKey: settingsKey(scope),
    retry: false,
    refetchInterval: (query) => (query.state.status === 'error' ? false : 30_000),
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
