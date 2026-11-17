import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCreatePackageType, usePackageTypes, usePackageTypeSelling } from './use-package-types';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get, POST: post }) }));
beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

const id = '01920000-0000-7000-8000-0000000000a2';
const record = {
  id,
  business_id: id,
  name_en: 'Synthetic service',
  name_ar: null,
  price: '12.500',
  validity_days: 90,
  components: [{ service_id: id, sessions: 10, name_en: 'Free', name_ar: null, price: '0.000' }],
  revision: 1,
  selling_stopped_at: null,
  created_at: '2026-10-05T10:00:00Z',
  updated_at: '2026-10-05T10:00:00Z',
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

it('creates through the generated client and normalizes the optional Arabic name', async () => {
  post.mockResolvedValueOnce({ data: record });
  const hook = renderHook(() => useCreatePackageType(id, id, id), { wrapper });
  await act(async () => {
    expect(
      await hook.result.current.mutateAsync({
        name_en: 'Synthetic service',
        price: '12.500',
        validity_days: 90,
        components: [{ service_id: id, sessions: 10 }],
      }),
    ).toEqual(record);
  });
  expect(post).toHaveBeenCalledWith('/v1/businesses/{businessId}/package-types', {
    params: { header: { 'x-company-id': id }, path: { businessId: id } },
    body: {
      name_en: 'Synthetic service',
      name_ar: null,
      price: '12.500',
      validity_days: 90,
      components: [{ service_id: id, sessions: 10 }],
    },
  });
});

it('preserves the bilingual server refusal without automatically retrying a create', async () => {
  const error = {
    code: 'FORBIDDEN',
    message_ar: t('ar', 'errors.FORBIDDEN'),
    message_en: 'Synthetic refusal',
  };
  post.mockResolvedValueOnce({ error });
  const hook = renderHook(() => useCreatePackageType(id, id, id), { wrapper });
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({
        name_en: 'Synthetic service',
        price: '12.500',
        validity_days: 90,
        components: [{ service_id: id, sessions: 10 }],
      }),
    ).rejects.toEqual(error);
  });
});

const stoppedAt = '2026-11-14T08:00:00.000Z';
const page = (sellingStoppedAt: string | null, revision: number) => ({
  items: [
    {
      id,
      name_en: record.name_en,
      name_ar: null,
      price: record.price,
      validity_days: record.validity_days,
      component_count: 1,
      revision,
      selling_stopped_at: sellingStoppedAt,
    },
  ],
  next_cursor: null,
  can_manage: true,
});

it.each([
  {
    action: 'stop' as const,
    endpoint: 'stop-selling',
    before: null,
    after: stoppedAt,
    revision: 1,
  },
  {
    action: 'resume' as const,
    endpoint: 'resume-selling',
    before: stoppedAt,
    after: null,
    revision: 2,
  },
])('$action posts the expected revision and refetches the changed list state', async (test) => {
  get.mockResolvedValueOnce({ data: page(test.before, test.revision) });
  const hook = renderHook(
    () => ({
      list: usePackageTypes(id, id, id),
      selling: usePackageTypeSelling(id, id, id),
    }),
    { wrapper },
  );
  await waitFor(() =>
    expect(hook.result.current.list.data?.items[0]?.selling_stopped_at).toBe(test.before),
  );
  post.mockResolvedValueOnce({
    data: { ...record, revision: test.revision + 1, selling_stopped_at: test.after },
  });
  get.mockResolvedValueOnce({ data: page(test.after, test.revision + 1) });
  await act(async () => {
    await hook.result.current.selling.mutateAsync({
      packageTypeId: id,
      expectedRevision: test.revision,
      action: test.action,
    });
  });
  await waitFor(() =>
    expect(hook.result.current.list.data?.items[0]?.selling_stopped_at).toBe(test.after),
  );
  expect(post).toHaveBeenCalledWith(
    `/v1/businesses/{businessId}/package-types/{packageTypeId}/${test.endpoint}`,
    {
      params: { header: { 'x-company-id': id }, path: { businessId: id, packageTypeId: id } },
      body: { expected_revision: test.revision },
    },
  );
});
