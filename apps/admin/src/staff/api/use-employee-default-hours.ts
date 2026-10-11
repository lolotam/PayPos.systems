'use client';
import { employeeDefaultShifts, setEmployeeDefaultShiftsInput, type SetEmployeeDefaultShiftsInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiClient } from '@/shared/api/client';

export function useEmployeeDefaultHours(companyId: string, businessId: string, userId: string, employeeId: string) {
  const client = useQueryClient();
  const key = ['employee-default-hours', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const current = useQuery({ queryKey: key, staleTime: 0, refetchOnMount: 'always', retry: false,
    refetchInterval: 30_000, queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/employees/{employeeId}/default-shifts', { params, signal });
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeDefaultShifts.parse(result.data);
    } });
  const save = useMutation({ mutationKey: [...key, 'set'], gcTime: 0, retry: false,
    mutationFn: async ({ branchId, input }: { branchId: string; input: SetEmployeeDefaultShiftsInput }) => {
      const body = setEmployeeDefaultShiftsInput.parse(input);
      const result = await apiClient().PUT('/v1/businesses/{businessId}/employees/{employeeId}/branches/{branchId}/default-shifts', {
        params: { ...params, path: { ...params.path, branchId } }, body: {
          shifts: body.shifts.map((shift) => ({ ...shift, break_start: shift.break_start ?? null, break_end: shift.break_end ?? null })),
        },
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeDefaultShifts.parse(result.data);
    }, onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: ['schedules', companyId, businessId] })]);
    }, onError: async () => {
      await client.invalidateQueries({ queryKey: key });
    } });
  const accessDenied = [403, 404].includes((current.error as { status?: number } | null)?.status ?? 0);
  const clear = useCallback(() => {
    client.removeQueries({ queryKey: ['employee-default-hours', companyId, businessId, userId, employeeId] });
    const mutations = client.getMutationCache();
    for (const mutation of mutations.findAll({ mutationKey: ['employee-default-hours', companyId, businessId, userId, employeeId, 'set'], exact: true }))
      mutations.remove(mutation);
  }, [client, companyId, businessId, userId, employeeId]);
  useEffect(() => clear, [clear]);
  useEffect(() => { if (accessDenied) clear(); }, [accessDenied, clear]);
  return { current, save, accessDenied };
}
