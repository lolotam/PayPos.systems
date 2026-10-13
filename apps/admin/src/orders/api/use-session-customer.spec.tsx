import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSessionCustomer } from './use-session-customer';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
const id = '01920000-0000-7000-8000-0000000000a2';
const input = { name: ' Synthetic customer ', phone: { calling_code: '999', national_number: '00000001' }, locale: 'en' as const };
const saved = { id, name: 'Existing name', locale: 'ar', opted_out: true, phone: '***001' };
const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } });
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('uses the branch route and company header, validates input and parses the returned customer', async () => {
  post.mockResolvedValueOnce({ data: saved });
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  await act(async () => expect(await hook.result.current.mutateAsync(input)).toEqual(saved));
  expect(post).toHaveBeenLastCalledWith('/v1/branches/{branchId}/customers/find-or-create', {
    params: { header: { 'x-company-id': 'company' }, path: { branchId: 'branch' } },
    body: { ...input, name: 'Synthetic customer' },
  });
  expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual(['session-customer', 'company', 'branch', 'actor']);
});

it('retains status and refusal details without retry or permission fallback', async () => {
  post.mockClear();
  const error = { code: 'FORBIDDEN', message_ar: 'Synthetic refusal AR', message_en: 'Synthetic refusal EN', details: { scope: 'branch' } };
  post.mockResolvedValueOnce({ error, response: { status: 403 } });
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toEqual({ ...error, status: 403 }); });
  expect(post).toHaveBeenCalledTimes(1);
});

it('rejects invalid entry before HTTP and refuses an unmasked response', async () => {
  post.mockClear();
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  await act(async () => { await expect(hook.result.current.mutateAsync({ ...input, name: '' })).rejects.toThrow(); });
  expect(post).not.toHaveBeenCalled();
  post.mockResolvedValueOnce({ data: { ...saved, phone: '00000001' } });
  await act(async () => { await expect(hook.result.current.mutateAsync(input)).rejects.toThrow(); });
});
