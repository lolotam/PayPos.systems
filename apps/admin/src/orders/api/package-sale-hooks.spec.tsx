import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SellPackageInput } from '@pospay/contracts';
import {
  mockPackageSaleSellerPages as mockSellerPages,
  mockPackageSaleSellerRefresh,
  packageSaleContext,
  packageSaleSeller,
  packageSaleSellerCalls as sellerCalls,
} from '../ui/package-sale-status.fixture';
import { usePackageSaleSellers } from './use-package-sale-context';
import { usePackageSaleStatus } from './use-package-sale-status';
import { useSellPackage } from './use-sell-package';
import { useSellablePackageTypes } from './use-sellable-package-types';

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: state.get, POST: state.post }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const scope = {
  companyId: 'company',
  businessId: 'business',
  branchId: 'branch',
  userId: 'actor',
};
const saleId = '01920000-0000-7000-8000-000000000020';
const packageType = {
  id: '01920000-0000-7000-8000-000000000021',
  revision: 1,
  name_en: 'Synthetic package',
  name_ar: null,
  price: '25.000',
  validity_days: 90,
  components: [
    {
      service_id: '01920000-0000-7000-8000-000000000022',
      service_revision: 3,
      name_en: 'Synthetic service',
      name_ar: null,
      sessions: 10,
      list_price: '2.500',
    },
  ],
};
const body: SellPackageInput = {
  customer_id: '01920000-0000-7000-8000-000000000023',
  package_type_id: packageType.id,
  expected_type_revision: 1,
  expected_service_revisions: [
    { service_id: packageType.components[0]?.service_id ?? '', revision: 3 },
  ],
  price_paid: '22.500',
  paid_method: 'CASH',
  seller_employee_id: '01920000-0000-7000-8000-000000000024',
};
const accepted = {
  data: { sale_request_id: saleId },
  response: { status: 202 },
};

function clientWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

async function send(mutate: (input: SellPackageInput) => Promise<string>, input = body) {
  return act(async () => mutate(input).catch(() => null));
}

const keyAt = (index: number) => state.post.mock.calls[index]?.[1].params.header['Idempotency-Key'];

async function expectStatusOnlyRecheck(
  recheck: () => void,
  data: () => { status: string } | undefined,
) {
  state.get.mockResolvedValueOnce({
    data: {
      status: 'failed',
      error: { code: 'PACKAGE_SALE_FAILED', message_ar: 'AR', message_en: 'EN' },
    },
    response: { status: 200 },
  });
  const beforeRecheck = state.get.mock.calls.length;
  await act(async () => {
    recheck();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(state.get).toHaveBeenCalledTimes(beforeRecheck + 1);
  expect(data()?.status).toBe('failed');
  expect(state.post).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(state.get).toHaveBeenCalledTimes(beforeRecheck + 1);
}

beforeEach(() => {
  state.get.mockReset();
  state.post.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it('loads and flattens sellable pages with the company header and keyset cursor', async () => {
  state.get
    .mockResolvedValueOnce({
      data: { items: [packageType], next_cursor: packageType.id },
      response: { status: 200 },
    })
    .mockResolvedValueOnce({
      data: { items: [], next_cursor: null },
      response: { status: 200 },
    });
  const hook = renderHook(() => useSellablePackageTypes(scope), {
    wrapper: clientWrapper(newClient()),
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => {
    await hook.result.current.fetchNextPage();
  });
  expect(hook.result.current.data?.items).toEqual([packageType]);
  expect(state.get.mock.calls.map(([, init]) => init.params)).toEqual([
    {
      header: { 'x-company-id': 'company' },
      path: { businessId: 'business', branchId: 'branch' },
      query: { limit: 20 },
    },
    {
      header: { 'x-company-id': 'company' },
      path: { businessId: 'business', branchId: 'branch' },
      query: { limit: 20, cursor: packageType.id },
    },
  ]);
});

it('aborts an obsolete picker request and never merges its late page into a new scope', async () => {
  let finish!: (response: unknown) => void;
  state.get
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({
      data: { items: [], next_cursor: null },
      response: { status: 200 },
    });
  const hook = renderHook(({ place }) => useSellablePackageTypes(place), {
    wrapper: clientWrapper(newClient()),
    initialProps: { place: scope },
  });
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
  const signal = state.get.mock.calls[0]?.[1].signal as AbortSignal;
  hook.rerender({
    place: { ...scope, branchId: 'replacement', userId: 'replacement-user' },
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    finish({ data: { items: [packageType], next_cursor: 'obsolete' } });
  });
  expect(hook.result.current.data?.items).toEqual([]);
});

it('reuses one idempotency key after an uncertain network failure for the identical body', async () => {
  state.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(accepted);
  const hook = renderHook(() => useSellPackage(scope), {
    wrapper: clientWrapper(newClient()),
  });
  await send(hook.result.current.mutateAsync);
  await send(hook.result.current.mutateAsync);
  expect(keyAt(1)).toBe(keyAt(0));
  expect(state.post.mock.calls[1]?.[1].body).toEqual(body);
});

it('mints a new key when the body changes after an uncertain failure', async () => {
  state.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(accepted);
  const changed = renderHook(() => useSellPackage(scope), {
    wrapper: clientWrapper(newClient()),
  });
  await send(changed.result.current.mutateAsync);
  await send(changed.result.current.mutateAsync, {
    ...body,
    price_paid: '23.000',
  });
  expect(keyAt(1)).not.toBe(keyAt(0));
});

it('mints a new key after a definitive refusal', async () => {
  state.post
    .mockResolvedValueOnce({
      error: {
        code: 'IDEMPOTENCY_KEY_REUSED',
        message_ar: 'AR',
        message_en: 'EN',
      },
      response: { status: 422 },
    })
    .mockResolvedValueOnce(accepted);
  const refused = renderHook(() => useSellPackage(scope), {
    wrapper: clientWrapper(newClient()),
  });
  await send(refused.result.current.mutateAsync);
  await send(refused.result.current.mutateAsync);
  expect(keyAt(1)).not.toBe(keyAt(0));
});

it('does not carry an uncertain attempt key into a changed request scope', async () => {
  state.post.mockRejectedValue(new Error('offline'));
  const hook = renderHook(({ place }) => useSellPackage(place), {
    wrapper: clientWrapper(newClient()),
    initialProps: { place: scope },
  });
  await send(hook.result.current.mutateAsync);
  hook.rerender({
    place: { ...scope, companyId: 'other-company', userId: 'other-user' },
  });
  await send(hook.result.current.mutateAsync);
  expect(keyAt(1)).not.toBe(keyAt(0));
});

it('polls each second, resets the 60s lifetime by scope, and rechecks status without another sale', async () => {
  vi.useFakeTimers();
  state.get.mockResolvedValue({
    data: { status: 'pending' },
    response: { status: 200 },
  });
  const hook = renderHook(({ place }) => usePackageSaleStatus(place, saleId), {
    wrapper: clientWrapper(newClient()),
    initialProps: { place: scope },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(hook.result.current.data).toEqual({ status: 'pending' });
  const initialCalls = state.get.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(999);
  });
  expect(state.get).toHaveBeenCalledTimes(initialCalls);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(state.get).toHaveBeenCalledTimes(initialCalls + 1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(29_000);
  });
  hook.rerender({
    place: { ...scope, branchId: 'new-branch', userId: 'new-user' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(hook.result.current.timedOut).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(hook.result.current.timedOut).toBe(true);

  await expectStatusOnlyRecheck(hook.result.current.recheck, () => hook.result.current.data);
});

it('times out an unresolved first GET and cancels it for a status-only recheck', async () => {
  vi.useFakeTimers();
  state.get.mockImplementationOnce(() => new Promise(() => {}));
  const hook = renderHook(() => usePackageSaleStatus(scope, saleId), {
    wrapper: clientWrapper(newClient()),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const heldSignal = state.get.mock.calls[0]?.[1].signal as AbortSignal;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(hook.result.current.timedOut).toBe(true);
  expect(hook.result.current.data).toBeUndefined();
  state.get.mockResolvedValueOnce({
    data: { status: 'pending' },
    response: { status: 200 },
  });
  await act(async () => {
    hook.result.current.recheck();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(heldSignal.aborted).toBe(true);
  expect(state.get).toHaveBeenCalledTimes(2);
  expect(state.post).not.toHaveBeenCalled();
});

it('cancels an unresolved status GET when the request identity changes', async () => {
  state.get.mockImplementation(() => new Promise(() => {}));
  const hook = renderHook(({ id }) => usePackageSaleStatus(scope, id), {
    wrapper: clientWrapper(newClient()),
    initialProps: { id: saleId },
  });
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(1));
  const signal = state.get.mock.calls[0]?.[1].signal as AbortSignal;
  hook.rerender({ id: '01920000-0000-7000-8000-000000000025' });
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  expect(signal.aborted).toBe(true);
  expect(state.post).not.toHaveBeenCalled();
});

it('times out and replaces a held subsequent GET without losing the accepted request', async () => {
  vi.useFakeTimers();
  state.get
    .mockResolvedValueOnce({
      data: { status: 'pending' },
      response: { status: 200 },
    })
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({
      data: { status: 'pending' },
      response: { status: 200 },
    });
  const hook = renderHook(() => usePackageSaleStatus(scope, saleId), {
    wrapper: clientWrapper(newClient()),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  const heldSignal = state.get.mock.calls[1]?.[1].signal as AbortSignal;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(59_000);
  });
  expect(hook.result.current.timedOut).toBe(true);
  await act(async () => {
    hook.result.current.recheck();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(heldSignal.aborted).toBe(true);
  expect(state.get).toHaveBeenCalledTimes(3);
  expect(hook.result.current.data).toEqual({ status: 'pending' });
  expect(state.post).not.toHaveBeenCalled();
});

it('follows seller cursors only while the selected seller is absent and cancels an obsolete page', async () => {
  let anchor = packageSaleContext.generated_at;
  mockPackageSaleSellerRefresh(state.get, () => anchor);
  const hook = renderHook(() => usePackageSaleSellers(scope, true, packageSaleSeller.id), {
    wrapper: clientWrapper(newClient()),
  });
  await waitFor(() => {
    expect(sellerCalls(state.get)).toHaveLength(2);
  });
  const obsolete = state.get.mock.calls.at(-1)?.[1].signal as AbortSignal;
  expect(obsolete.aborted).toBe(false);
  anchor = '2026-10-02T08:00:00.000Z';
  await act(async () => {
    await hook.result.current.context.refetch();
  });
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(obsolete.aborted).toBe(true));
  const latest = state.get.mock.calls
    .filter(([path]) => String(path).endsWith('/seller-options'))
    .at(-1);
  expect(latest?.[1].params.query).toMatchObject({ occurred_at: anchor });
  expect(latest?.[1].params.query.cursor).toBeUndefined();
});

it('keeps ordinary seller pagination manual when no seller is selected', async () => {
  mockSellerPages(state.get, [packageSaleSeller], null);
  const hook = renderHook(() => usePackageSaleSellers(scope), {
    wrapper: clientWrapper(newClient()),
  });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(sellerCalls(state.get)).toHaveLength(1);
  await act(async () => {
    await hook.result.current.fetchNextPage();
  });
  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
  expect(sellerCalls(state.get)).toHaveLength(2);
});

it('stops following cursors as soon as the selected seller is found', async () => {
  mockSellerPages(state.get, [packageSaleSeller], 'page-3');
  const hook = renderHook(() => usePackageSaleSellers(scope, true, packageSaleSeller.id), {
    wrapper: clientWrapper(newClient()),
  });
  await waitFor(() => expect(hook.result.current.data?.pages).toHaveLength(2));
  await act(async () => {
    await Promise.resolve();
  });
  expect(hook.result.current.hasNextPage).toBe(true);
  expect(sellerCalls(state.get)).toHaveLength(2);
});
