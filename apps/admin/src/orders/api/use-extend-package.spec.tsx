import type { ExtendPackageInput } from '@pospay/contracts';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useExtendPackage } from './use-extend-package';

const state = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: state.post, GET: state.get }) }));

const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const customerId = 'customer';
const entitlementId = '01920000-0000-7000-8000-000000000006';
const body: ExtendPackageInput = {
  new_expires_on: '2027-01-31',
  expected_expires_on: '2026-12-30',
  reason: 'Synthetic reason',
};
const saved = {
  data: {
    id: '01920000-0000-7000-8000-000000000007',
    entitlement_id: entitlementId,
    previous_expires_on: '2026-12-30',
    new_expires_on: '2027-01-31',
    extended_at: '2027-01-01T08:00:00.000Z',
  },
  response: { status: 201 },
};
const path = '/v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/extensions';

function refusal(status: number, code: string) {
  return { error: { code, message_ar: 'Synthetic AR', message_en: 'Synthetic EN' }, response: { status } };
}

function setup(withQueries = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => {
    const mutation = useExtendPackage(scope, customerId, entitlementId);
    const detail = useQuery({
      queryKey: ['customer-package-detail', ...Object.values(scope), customerId],
      queryFn: () => apiClientForTest('detail'),
      enabled: withQueries,
    });
    const list = useQuery({
      queryKey: ['customer-packages', ...Object.values(scope), customerId],
      queryFn: () => apiClientForTest('list'),
      enabled: withQueries,
    });
    return { mutation, detail, list };
  }, { wrapper });
}

function apiClientForTest(name: string) {
  return state.get(name) as Promise<unknown>;
}

async function send(hook: ReturnType<typeof setup>, value = body) {
  try {
    return await act(() => hook.result.current.mutation.mutateAsync(value));
  } catch {
    return null;
  }
}

const keyOf = (index: number) =>
  state.post.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;

beforeEach(() => {
  state.post.mockReset();
  state.get.mockReset();
  state.get.mockResolvedValue({ data: {}, response: { status: 200 } });
});

it('posts the exact path, headers and body and parses the 201 response', async () => {
  state.post.mockResolvedValueOnce(saved);
  const hook = setup();
  const result = await send(hook);
  expect(result).toEqual(saved.data);
  expect(state.post).toHaveBeenCalledWith(path, {
    params: {
      header: { 'x-company-id': scope.companyId, 'Idempotency-Key': expect.any(String) },
      path: { businessId: scope.businessId, branchId: scope.branchId, entitlementId },
    },
    body,
  });
  expect(Object.keys(state.post.mock.calls[0]?.[1].body ?? {}).sort())
    .toEqual(['expected_expires_on', 'new_expires_on', 'reason']);
});

it.each([[500], [429], [409]] as const)('keeps one key after retryable status %s', async (status) => {
  const code = status === 409 ? 'IDEMPOTENCY_KEY_IN_PROGRESS' : 'TEMPORARY';
  state.post.mockResolvedValueOnce(refusal(status, code)).mockResolvedValueOnce(saved);
  const hook = setup();
  await send(hook);
  await send(hook);
  expect(state.post).toHaveBeenCalledTimes(2);
  expect(keyOf(1)).toBe(keyOf(0));
});

it('keeps one key after a network error', async () => {
  state.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(saved);
  const hook = setup();
  await send(hook);
  await send(hook);
  expect(keyOf(1)).toBe(keyOf(0));
});

it.each([[403], [404], [409], [422]] as const)('mints a new key after definitive status %s', async (status) => {
  const code = status === 409 ? 'PACKAGE_EXPIRY_STALE' : 'REFUSED';
  state.post.mockResolvedValueOnce(refusal(status, code)).mockResolvedValueOnce(saved);
  const hook = setup();
  await send(hook);
  await send(hook);
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('mints a new key after success and after changing the body', async () => {
  state.post.mockResolvedValue(saved);
  const hook = setup();
  await send(hook);
  await send(hook);
  expect(keyOf(1)).not.toBe(keyOf(0));
  await send(hook, { ...body, reason: 'Changed synthetic reason' });
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('invalidates detail and list queries after success', async () => {
  state.post.mockResolvedValueOnce(saved);
  const hook = setup(true);
  await waitFor(() => {
    expect(hook.result.current.detail.isSuccess).toBe(true);
    expect(hook.result.current.list.isSuccess).toBe(true);
  });
  state.get.mockClear();
  await send(hook);
  await waitFor(() => {
    expect(state.get.mock.calls.map((call) => call[0]).sort()).toEqual(['detail', 'list']);
  });
});
