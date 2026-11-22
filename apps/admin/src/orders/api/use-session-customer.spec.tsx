import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSessionCustomer } from './use-session-customer';

const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: post }) }));
const id = '01920000-0000-7000-8000-0000000000a2';
const input = {
  name: ' Synthetic customer ',
  phone: { calling_code: '999', national_number: '00000001' },
  locale: 'en' as const,
};
const saved = { id, name: 'Existing name', locale: 'ar', opted_out: true, phone: '***001' };
const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } });
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('uses the branch route by default with company header, validation and response parsing', async () => {
  post.mockResolvedValueOnce({ data: saved });
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  await act(async () => expect(await hook.result.current.mutateAsync(input)).toEqual(saved));
  expect(post).toHaveBeenLastCalledWith('/v1/branches/{branchId}/customers/find-or-create', {
    params: { header: { 'x-company-id': 'company' }, path: { branchId: 'branch' } },
    body: { ...input, name: 'Synthetic customer' },
    signal: expect.any(AbortSignal),
  });
  expect(client.getMutationCache().getAll().at(-1)?.options.mutationKey).toEqual([
    'session-customer',
    'company',
    'branch',
    'actor',
    'branch',
    undefined,
  ]);
});

it.each([
  ['company', '/v1/customers/find-or-create', {}],
  ['business', '/v1/businesses/{businessId}/customers/find-or-create', { businessId: 'business' }],
] as const)(
  'uses the existing authorized %s route without a permission fallback',
  async (scope, path, pathParams) => {
    post.mockClear();
    post.mockResolvedValueOnce({ data: saved });
    const hook = renderHook(
      () => useSessionCustomer('company', 'branch', 'actor', scope, 'business'),
      { wrapper },
    );
    await act(async () => {
      await hook.result.current.mutateAsync(input);
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(path, {
      params: {
        header: { 'x-company-id': 'company' },
        ...(Object.keys(pathParams).length ? { path: pathParams } : {}),
      },
      body: { ...input, name: 'Synthetic customer' },
      signal: expect.any(AbortSignal),
    });
  },
);

it('retains status and refusal details without retry or permission fallback', async () => {
  post.mockClear();
  const error = {
    code: 'FORBIDDEN',
    message_ar: 'Synthetic refusal AR',
    message_en: 'Synthetic refusal EN',
    details: { scope: 'branch' },
  };
  post.mockResolvedValueOnce({ error, response: { status: 403 } });
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(input)).rejects.toEqual({ ...error, status: 403 });
  });
  expect(post).toHaveBeenCalledTimes(1);
});

it('sends one typed scoped body and omits blank optional controls and an unknown year', async () => {
  post.mockClear();
  post.mockResolvedValueOnce({ data: saved });
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor', 'business', 'business'), {
    wrapper,
  });
  await act(async () => {
    await hook.result.current.mutateAsync({
      ...input,
      gender: 'female',
      birthday: { day: 5, month: 3 },
      email: 'a@b.test',
      note: 'a first line\na second line',
    });
  });
  expect(post).toHaveBeenCalledWith('/v1/businesses/{businessId}/customers/find-or-create', {
    params: { header: { 'x-company-id': 'company' }, path: { businessId: 'business' } },
    body: {
      ...input,
      name: 'Synthetic customer',
      gender: 'female',
      birthday: { day: 5, month: 3 },
      email: 'a@b.test',
      note: 'a first line\na second line',
    },
    signal: expect.any(AbortSignal),
  });
});

it('keeps blank and supplied-year controls out of the body and allows a genderless lookup', async () => {
  post.mockClear();
  post.mockResolvedValueOnce({ data: saved });
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({
      ...input,
      gender: undefined,
      birthday: { day: 5, month: 3, year: 1990 },
      email: '',
      note: '',
    });
  });
  const body = post.mock.lastCall?.[1].body;
  expect(body).toEqual({
    ...input,
    name: 'Synthetic customer',
    birthday: { day: 5, month: 3, year: 1990 },
  });
  expect(body).not.toHaveProperty('gender');
  expect(body).not.toHaveProperty('email');
  expect(body).not.toHaveProperty('note');
});

it('aborts an in-flight request when the entry is reset', async () => {
  post.mockClear();
  let captured: AbortSignal | undefined;
  post.mockImplementationOnce((_path, init) => {
    captured = init.signal as AbortSignal;
    return new Promise(() => undefined);
  });
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  const pending = hook.result.current.mutateAsync(input);
  await waitFor(() => expect(captured).toBeDefined());
  hook.result.current.reset();
  expect(captured?.aborted).toBe(true);
  void pending.catch(() => undefined);
});

it('refuses a company note before HTTP instead of dropping it', async () => {
  post.mockClear();
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor', 'company'), {
    wrapper,
  });
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ ...input, note: 'Synthetic note' }),
    ).rejects.toThrow('CUSTOMER_NOTE_NOT_ALLOWED');
  });
  expect(post).not.toHaveBeenCalled();
});

it('rejects invalid entry before HTTP and refuses an unmasked response', async () => {
  post.mockClear();
  const hook = renderHook(() => useSessionCustomer('company', 'branch', 'actor'), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync({ ...input, name: '' })).rejects.toThrow();
  });
  expect(post).not.toHaveBeenCalled();
  post.mockResolvedValueOnce({ data: { ...saved, phone: '00000001' } });
  await act(async () => {
    await expect(hook.result.current.mutateAsync(input)).rejects.toThrow();
  });
});
