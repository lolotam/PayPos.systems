import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCreatePackageType } from './use-package-types';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));

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
