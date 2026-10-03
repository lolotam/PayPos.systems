import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCreateEmployee } from './use-create-employee';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
const id = '01920000-0000-7000-8000-0000000000a2';
const input = {
  primary_branch_id: id,
  name_en: 'Synthetic employee',
  role_code: 'staff' as const,
  hire_date: '2026-01-01',
};
const record = {
  ...input,
  id,
  business_id: id,
  name_ar: null,
  contract_end: null,
  user_id: null,
  created_at: '2026-10-03T00:00:00Z',
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
it('sends selected company/business through the generated client and normalizes optional fields', async () => {
  post.mockResolvedValueOnce({ data: record });
  const hook = renderHook(() => useCreateEmployee(id, id, id), { wrapper });
  await act(async () => {
    expect(await hook.result.current.mutateAsync(input)).toEqual(record);
  });
  expect(post).toHaveBeenCalledWith('/v1/businesses/{businessId}/employees', {
    params: { header: { 'x-company-id': id }, path: { businessId: id } },
    body: { ...input, name_ar: null, contract_end: null, user_id: null },
  });
});
it('preserves the bilingual server refusal without automatically retrying a create', async () => {
  const error = {
    code: 'FORBIDDEN',
    message_ar: t('ar', 'errors.FORBIDDEN'),
    message_en: 'Synthetic refusal',
  };
  post.mockResolvedValueOnce({ error });
  const hook = renderHook(() => useCreateEmployee(id, id, id), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(input)).rejects.toEqual(error);
  });
});
