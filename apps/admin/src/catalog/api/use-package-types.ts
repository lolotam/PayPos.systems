'use client';
import {
  packageTypeDetail,
  packageTypePage,
  type CreatePackageTypeInput,
  type PackageTypeDetail,
  type PackageTypePage,
  type UpdatePackageTypeInput,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

const key = (companyId: string, businessId: string, userId: string) =>
  ['package-types', companyId, businessId, userId] as const;

async function list(
  companyId: string,
  businessId: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<PackageTypePage> {
  const result = await apiClient().GET('/v1/businesses/{businessId}/package-types', {
    params: {
      header: { 'x-company-id': companyId },
      path: { businessId },
      query: { limit: 20, ...(cursor ? { cursor } : {}) },
    },
    signal,
  });
  if (result.error) throw result.error;
  return packageTypePage.parse(result.data);
}

async function detail(
  companyId: string,
  businessId: string,
  packageTypeId: string,
  signal: AbortSignal,
): Promise<PackageTypeDetail> {
  const result = await apiClient().GET(
    '/v1/businesses/{businessId}/package-types/{packageTypeId}',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, packageTypeId } },
      signal,
    },
  );
  if (result.error) throw result.error;
  return packageTypeDetail.parse(result.data);
}

async function create(
  companyId: string,
  businessId: string,
  body: CreatePackageTypeInput,
): Promise<PackageTypeDetail> {
  const response = await apiClient().POST('/v1/businesses/{businessId}/package-types', {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: {
      name_en: body.name_en,
      name_ar: body.name_ar ?? null,
      price: body.price,
      validity_days: body.validity_days,
      components: body.components,
    },
  });
  if (response.error) throw response.error;
  return packageTypeDetail.parse(response.data);
}

async function update(
  companyId: string,
  businessId: string,
  packageTypeId: string,
  body: UpdatePackageTypeInput,
): Promise<PackageTypeDetail> {
  const response = await apiClient().PATCH(
    '/v1/businesses/{businessId}/package-types/{packageTypeId}',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, packageTypeId } },
      body: {
        expected_revision: body.expected_revision,
        name_en: body.name_en,
        name_ar: body.name_ar,
        price: body.price,
        validity_days: body.validity_days,
        components: body.components,
      },
    },
  );
  if (response.error) throw response.error;
  return packageTypeDetail.parse(response.data);
}

export function usePackageTypes(
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

export function useCreatePackageType(companyId: string, businessId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['create-package-type', companyId, businessId, userId],
    mutationFn: (body: CreatePackageTypeInput) => create(companyId, businessId, body),
    onSuccess: () => client.invalidateQueries({ queryKey: key(companyId, businessId, userId) }),
  });
}

export function usePackageTypeEdit(
  companyId: string,
  businessId: string,
  userId: string,
  packageTypeId: string,
) {
  const client = useQueryClient();
  const queryKey = [...key(companyId, businessId, userId), 'detail', packageTypeId];
  const record = useQuery({
    queryKey,
    queryFn: ({ signal }) => detail(companyId, businessId, packageTypeId, signal),
    refetchOnWindowFocus: false,
  });
  const save = useMutation({
    mutationKey: [...queryKey, 'update'],
    retry: false,
    mutationFn: (body: UpdatePackageTypeInput) =>
      update(companyId, businessId, packageTypeId, body),
    onSuccess: (saved) => {
      client.setQueryData(queryKey, saved);
      return client.invalidateQueries({
        queryKey: [...key(companyId, businessId, userId), 'list'],
      });
    },
  });
  return { record, save };
}
