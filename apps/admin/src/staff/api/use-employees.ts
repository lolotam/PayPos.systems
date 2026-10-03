'use client';
import { employeePage, employeeDetailRecord, type UpdateEmployeeInput } from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

const key = (companyId: string, businessId: string, userId: string) =>
  ['employees', companyId, businessId, userId] as const;
async function list(
  companyId: string,
  businessId: string,
  cursor: string | undefined,
  signal: AbortSignal,
) {
  const result = await apiClient().GET('/v1/businesses/{businessId}/employees', {
    params: {
      header: { 'x-company-id': companyId },
      path: { businessId },
      query: { limit: 20, ...(cursor ? { cursor } : {}) },
    },
    signal,
  });
  if (result.error) throw result.error;
  return employeePage.parse(result.data);
}
async function detail(
  companyId: string,
  businessId: string,
  employeeId: string,
  signal: AbortSignal,
) {
  const result = await apiClient().GET('/v1/businesses/{businessId}/employees/{employeeId}', {
    params: { header: { 'x-company-id': companyId }, path: { businessId, employeeId } },
    signal,
  });
  if (result.error) throw result.error;
  return employeeDetailRecord.parse(result.data);
}
async function update(
  companyId: string,
  businessId: string,
  employeeId: string,
  body: UpdateEmployeeInput,
) {
  const result = await apiClient().PATCH('/v1/businesses/{businessId}/employees/{employeeId}', {
    params: { header: { 'x-company-id': companyId }, path: { businessId, employeeId } },
    body: {
      ...body,
      name_ar: body.name_ar ?? null,
      contract_end: body.contract_end ?? null,
      user_id: body.user_id ?? null,
    },
  });
  if (result.error) throw result.error;
  return employeeDetailRecord.parse(result.data);
}
export function useEmployees(
  companyId: string,
  businessId: string,
  userId: string,
  cursor?: string,
) {
  return useQuery({
    queryKey: [...key(companyId, businessId, userId), 'list', cursor],
    queryFn: ({ signal }) => list(companyId, businessId, cursor, signal),
    refetchInterval: 30_000,
  });
}
export function useEmployeeEdit(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  const queryKey = [...key(companyId, businessId, userId), 'detail', employeeId];
  const record = useQuery({
    queryKey,
    queryFn: ({ signal }) => detail(companyId, businessId, employeeId, signal),
    refetchOnWindowFocus: false,
  });
  const save = useMutation({
    mutationKey: [...queryKey, 'update'],
    retry: false,
    mutationFn: (body: UpdateEmployeeInput) => update(companyId, businessId, employeeId, body),
    onMutate: () => ({ queryKey, listKey: key(companyId, businessId, userId) }),
    onSuccess: (saved, _terms, context) => {
      client.setQueryData(context.queryKey, saved);
      return client.invalidateQueries({ queryKey: [...context.listKey, 'list'] });
    },
  });
  return { record, save };
}
