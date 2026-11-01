import type { ReactNode } from 'react';
import type { UpdateServiceInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCreateService, useServiceEdit, useServices } from './use-services';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, PATCH: patch }),
}));

const id = '01920000-0000-7000-8000-0000000000a2';
const record = {
  id,
  business_id: id,
  name_en: 'Synthetic service',
  name_ar: null,
  price: '12.500',
  commission_rule: { kind: 'FOLLOW_PLAN' },
  counts_toward_threshold: true,
  duration_minutes: null,
  category_id: null,
  category: null,
  revision: 1,
  created_at: '2026-10-05T10:00:00Z',
  updated_at: '2026-10-05T10:00:00Z',
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

function updateTerms(categoryId?: string): UpdateServiceInput {
  return {
    expected_revision: 1,
    name_en: 'Synthetic service',
    name_ar: null,
    price: '12.500',
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 45,
    ...(categoryId ? { category_id: categoryId } : {}),
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
});

it('creates through the generated client with duration, category and a normalized Arabic name', async () => {
  post.mockResolvedValueOnce({ data: record });
  const hook = renderHook(() => useCreateService(id, id, id), { wrapper });
  await act(async () => {
    expect(
      await hook.result.current.mutateAsync({
        name_en: 'Synthetic service',
        price: '12.500',
        commission_rule: { kind: 'FOLLOW_PLAN' },
        counts_toward_threshold: true,
        duration_minutes: 90,
        category_id: id,
      }),
    ).toEqual(record);
  });
  expect(post).toHaveBeenCalledWith('/v1/businesses/{businessId}/services', {
    params: { header: { 'x-company-id': id }, path: { businessId: id } },
    body: {
      name_en: 'Synthetic service',
      name_ar: null,
      price: '12.500',
      commission_rule: { kind: 'FOLLOW_PLAN' },
      counts_toward_threshold: true,
      duration_minutes: 90,
      category_id: id,
    },
  });
});

it('updates through the generated client with duration and category', async () => {
  get.mockResolvedValueOnce({ data: record });
  patch.mockResolvedValueOnce({ data: record });
  const hook = renderHook(() => useServiceEdit(id, id, id, id), { wrapper });
  await act(async () => {
    expect(await hook.result.current.save.mutateAsync(updateTerms(id))).toEqual(record);
  });
  expect(patch).toHaveBeenCalledWith('/v1/businesses/{businessId}/services/{serviceId}', {
    params: { header: { 'x-company-id': id }, path: { businessId: id, serviceId: id } },
    body: updateTerms(id),
  });
});

it('leaves category_id absent when a refused category list kept it unknown', async () => {
  get.mockResolvedValueOnce({ data: record });
  patch.mockResolvedValueOnce({ data: record });
  const hook = renderHook(() => useServiceEdit(id, id, id, id), { wrapper });
  await act(async () => {
    await hook.result.current.save.mutateAsync(updateTerms());
  });
  const body = patch.mock.calls[0]?.[1].body as Record<string, unknown>;
  expect(body).not.toHaveProperty('category_id');
  expect(body.duration_minutes).toBe(45);
});

it('sends category_id when listing a filtered services page', async () => {
  get.mockResolvedValueOnce({ data: { items: [], next_cursor: null } });
  const hook = renderHook(() => useServices(id, id, id, { categoryId: id }), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledWith('/v1/businesses/{businessId}/services', {
    params: {
      header: { 'x-company-id': id },
      path: { businessId: id },
      query: { limit: 20, category_id: id },
    },
    signal: expect.any(AbortSignal),
  });
});

it('preserves the bilingual server refusal without automatically retrying a create', async () => {
  const error = {
    code: 'FORBIDDEN',
    message_ar: t('ar', 'errors.FORBIDDEN'),
    message_en: 'Synthetic refusal',
  };
  post.mockResolvedValueOnce({ error });
  const hook = renderHook(() => useCreateService(id, id, id), { wrapper });
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({
        name_en: 'Synthetic service',
        price: '12.500',
        commission_rule: { kind: 'FOLLOW_PLAN' },
        counts_toward_threshold: true,
      }),
    ).rejects.toEqual(error);
  });
});
