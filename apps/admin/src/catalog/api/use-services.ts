'use client';
import {
  service,
  servicePage,
  type CreateServiceInput,
  type Service,
  type ServicePage,
  type UpdateServiceInput,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

const key = (companyId: string, businessId: string, userId: string) =>
  ['services', companyId, businessId, userId] as const;

async function list(
  companyId: string,
  businessId: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<ServicePage> {
  const result = await apiClient().GET('/v1/businesses/{businessId}/services', {
    params: {
      header: { 'x-company-id': companyId },
      path: { businessId },
      query: { limit: 20, ...(cursor ? { cursor } : {}) },
    },
    signal,
  });
  if (result.error) throw result.error;
  return servicePage.parse(result.data);
}

async function detail(
  companyId: string,
  businessId: string,
  serviceId: string,
  signal: AbortSignal,
): Promise<Service> {
  const result = await apiClient().GET('/v1/businesses/{businessId}/services/{serviceId}', {
    params: { header: { 'x-company-id': companyId }, path: { businessId, serviceId } },
    signal,
  });
  if (result.error) throw result.error;
  return service.parse(result.data);
}

async function create(
  companyId: string,
  businessId: string,
  body: CreateServiceInput,
): Promise<Service> {
  const response = await apiClient().POST('/v1/businesses/{businessId}/services', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: {
      name_en: body.name_en,
      name_ar: body.name_ar ?? null,
      price: body.price,
      commission_rule: body.commission_rule,
      ...(body.counts_toward_threshold === undefined
        ? {}
        : { counts_toward_threshold: body.counts_toward_threshold }),
    },
  });
  if (response.error) throw response.error;
  return service.parse(response.data);
}

async function update(
  companyId: string,
  businessId: string,
  serviceId: string,
  body: UpdateServiceInput,
): Promise<Service> {
  const response = await apiClient().PATCH('/v1/businesses/{businessId}/services/{serviceId}', {
    params: { header: { 'x-company-id': companyId }, path: { businessId, serviceId } },
    body: {
      expected_revision: body.expected_revision,
      name_en: body.name_en,
      name_ar: body.name_ar,
      price: body.price,
      commission_rule: body.commission_rule,
      counts_toward_threshold: body.counts_toward_threshold,
    },
  });
  if (response.error) throw response.error;
  return service.parse(response.data);
}

export function useServices(
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

export function useCreateService(companyId: string, businessId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['create-service', companyId, businessId, userId],
    mutationFn: (body: CreateServiceInput) => create(companyId, businessId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: key(companyId, businessId, userId) }),
  });
}

export function useServiceEdit(
  companyId: string,
  businessId: string,
  userId: string,
  serviceId: string,
) {
  const client = useQueryClient();
  const queryKey = [...key(companyId, businessId, userId), 'detail', serviceId];
  const record = useQuery({
    queryKey,
    queryFn: ({ signal }) => detail(companyId, businessId, serviceId, signal),
    refetchOnWindowFocus: false,
  });
  const save = useMutation({
    mutationKey: [...queryKey, 'update'],
    retry: false,
    mutationFn: (body: UpdateServiceInput) => update(companyId, businessId, serviceId, body),
    onSuccess: (saved) => {
      client.setQueryData(queryKey, saved);
      return client.invalidateQueries({
        queryKey: [...key(companyId, businessId, userId), 'list'],
      });
    },
  });
  return { record, save };
}
