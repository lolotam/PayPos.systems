import type { ReactNode } from 'react';
import type { SellPackageInput } from '@pospay/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSellPackage } from './use-sell-package';

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
const otherScope = { ...scope, companyId: 'other-company', userId: 'other-user' };
const storageKeyFor = (place: typeof scope) =>
  `pospay:package-sale:${JSON.stringify(Object.values(place))}`;
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

function seedJournal(place: typeof scope, createdAt: number) {
  const scopeKey = JSON.stringify(Object.values(place));
  localStorage.setItem(
    storageKeyFor(place),
    JSON.stringify({
      key: '01920000-0000-7000-8000-0000000000a1',
      scope: scopeKey,
      createdAt,
      body,
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  state.get.mockReset();
  state.post.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'locks');
});

it('keeps scope B recovery while scope A is refused after the hook switched to B', async () => {
  seedJournal(otherScope, Date.now());
  const seeded = localStorage.getItem(storageKeyFor(otherScope));
  let settle!: (response: unknown) => void;
  state.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = resolve;
      }),
  );
  const hook = renderHook(({ place }) => useSellPackage(place), {
    wrapper: clientWrapper(newClient()),
    initialProps: { place: scope },
  });
  let inFlight!: Promise<string>;
  await act(async () => {
    inFlight = hook.result.current.mutateAsync(body).catch(() => 'refused');
  });
  await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  hook.rerender({ place: otherScope });
  await waitFor(() => expect(hook.result.current.recoveryRequired).toBe(true));
  await act(async () => {
    settle({ error: { code: 'FORBIDDEN' }, response: { status: 400 } });
    await inFlight;
  });
  expect(hook.result.current.recoveryRequired).toBe(true);
  expect(hook.result.current.journalUnsaved).toBe(false);
  expect(localStorage.getItem(storageKeyFor(otherScope))).toBe(seeded);
  expect(localStorage.getItem(storageKeyFor(scope))).toBeNull();
});

it('reports verificationRequired once the fake clock passes the expiry instant', async () => {
  vi.useFakeTimers();
  seedJournal(scope, Date.now() - (23 * 60 * 60 * 1000 - 1_000));
  const hook = renderHook(() => useSellPackage(scope), {
    wrapper: clientWrapper(newClient()),
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(hook.result.current.recoveryRequired).toBe(true);
  expect(hook.result.current.verificationRequired).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_100);
  });
  expect(hook.result.current.verificationRequired).toBe(true);
});

it('writes the accepted sale back after a failed reservation save', async () => {
  const saleId = '01920000-0000-7000-8000-0000000000b2';
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('full');
  });
  state.post.mockResolvedValueOnce({
    data: { sale_request_id: saleId },
    response: { status: 202 },
  });
  const hook = renderHook(() => useSellPackage(scope), {
    wrapper: clientWrapper(newClient()),
  });
  await act(async () => {
    await hook.result.current.mutateAsync(body);
  });
  setItem.mockRestore();
  const stored = JSON.parse(localStorage.getItem(storageKeyFor(scope)) ?? 'null') as {
    key?: unknown;
    saleId?: unknown;
  } | null;
  expect(stored?.saleId).toBe(saleId);
  expect(stored?.key).toEqual(expect.any(String));
  expect(hook.result.current.journalUnsaved).toBe(false);
  expect(hook.result.current.recoveryRequired).toBe(false);
});

const hour = 60 * 60 * 1000;
const minute = 60_000;
const acceptedSaleId = '01920000-0000-7000-8000-0000000000b2';

function seedRecord(createdAt: number, seenAt?: number) {
  const scopeKey = JSON.stringify(Object.values(scope));
  localStorage.setItem(
    storageKeyFor(scope),
    JSON.stringify({
      key: '01920000-0000-7000-8000-0000000000a1',
      scope: scopeKey,
      createdAt,
      ...(seenAt === undefined ? {} : { seenAt }),
      body,
    }),
  );
}

function refuseSaleIdWrites() {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (value.includes('"saleId"')) throw new Error('full');
    original.call(this, key, value);
  });
}

async function acceptSaleWithRefusedStatusWrite() {
  refuseSaleIdWrites();
  state.post.mockResolvedValueOnce({
    data: { sale_request_id: acceptedSaleId },
    response: { status: 202 },
  });
  const hook = renderHook(({ place }) => useSellPackage(place), {
    wrapper: clientWrapper(newClient()),
    initialProps: { place: scope },
  });
  await act(async () => {
    await hook.result.current.mutateAsync(body);
  });
  await waitFor(() => expect(hook.result.current.journalUnsaved).toBe(true));
  expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId);
  return hook;
}

it('keeps the expiry latch in memory when the observation write is refused', async () => {
  const created = 1_700_000_000_000;
  seedRecord(created, created + 22 * hour + 59 * minute);
  const now = vi.spyOn(Date, 'now').mockReturnValue(created + 23 * hour + 2 * minute);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  const hook = renderHook(() => useSellPackage(scope), { wrapper: clientWrapper(newClient()) });
  await waitFor(() => expect(hook.result.current.journalUnsaved).toBe(true));
  expect(hook.result.current.verificationRequired).toBe(true);
  now.mockReturnValue(created + 22 * hour + 58 * minute);
  await act(async () => {
    await expect(hook.result.current.mutateAsync(undefined)).rejects.toThrow(
      'PACKAGE_SALE_VERIFICATION_REQUIRED',
    );
  });
  expect(state.post).not.toHaveBeenCalled();
});

it('keeps an accepted sale across a scope round trip when its status write was refused', async () => {
  const hook = await acceptSaleWithRefusedStatusWrite();
  hook.rerender({ place: otherScope });
  await waitFor(() => expect(hook.result.current.restoredSaleId).toBeNull());
  hook.rerender({ place: scope });
  await waitFor(() => expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId));
  expect(hook.result.current.recoveryRequired).toBe(false);
});

it('ignores an older stored record for the same key and keeps the unsaved flag', async () => {
  const hook = await acceptSaleWithRefusedStatusWrite();
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: storageKeyFor(scope) }));
  });
  expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId);
  expect(hook.result.current.recoveryRequired).toBe(false);
  expect(hook.result.current.journalUnsaved).toBe(true);
});

// Holds every Web Lock request until `unblock`, so a write can be kept in flight on purpose.
function queueLockRequests() {
  const waiting: Array<() => void> = [];
  let blocked = true;
  const request = vi.fn(
    (_name: string, callback: () => unknown) =>
      new Promise((resolve, reject) => {
        const run = () => Promise.resolve().then(callback).then(resolve, reject);
        if (blocked) waiting.push(run);
        else run();
      }),
  );
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return {
    waiting,
    request,
    unblock: () => {
      blocked = false;
    },
  };
}

it('does not let a late observation replace an accepted sale', async () => {
  const start = 1_700_000_000_000;
  seedRecord(start - hour);
  const now = vi.spyOn(Date, 'now').mockReturnValue(start);
  const locks = queueLockRequests();
  const { waiting, request } = locks;
  refuseSaleIdWrites();
  state.post.mockResolvedValueOnce({
    data: { sale_request_id: acceptedSaleId },
    response: { status: 202 },
  });
  const hook = renderHook(() => useSellPackage(scope), { wrapper: clientWrapper(newClient()) });
  await waitFor(() => expect(waiting).toHaveLength(1));
  locks.unblock();
  now.mockReturnValue(start + 2 * minute);
  await act(async () => {
    await hook.result.current.mutateAsync(undefined);
  });
  expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId);
  await act(async () => {
    waiting.forEach((run) => run());
    await Promise.resolve();
  });
  // A late observation changes nothing visible, so its lock request is the only sign it ran.
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId);
  expect(hook.result.current.recoveryRequired).toBe(false);
});

it('raises no unsaved warning when a late observation fails after its entry was replaced', async () => {
  const start = 1_700_000_000_000;
  seedRecord(start - hour);
  const now = vi.spyOn(Date, 'now').mockReturnValue(start);
  const locks = queueLockRequests();
  const { waiting } = locks;
  state.post.mockResolvedValueOnce({
    data: { sale_request_id: acceptedSaleId },
    response: { status: 202 },
  });
  const hook = renderHook(() => useSellPackage(scope), { wrapper: clientWrapper(newClient()) });
  await waitFor(() => expect(waiting).toHaveLength(1));
  locks.unblock();
  now.mockReturnValue(start + 2 * minute);
  await act(async () => {
    await hook.result.current.mutateAsync(undefined);
  });
  expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId);
  expect(hook.result.current.journalUnsaved).toBe(false);
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('unreadable');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  await act(async () => {
    waiting.forEach((run) => run());
    await waitFor(() => expect(getItem).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId);
  expect(hook.result.current.journalUnsaved).toBe(false);
});

it('never writes over a device that became unreadable after a refused reservation', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new Error('full');
  });
  state.post.mockImplementationOnce(async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unreadable');
    });
    return { data: { sale_request_id: acceptedSaleId }, response: { status: 202 } };
  });
  const hook = renderHook(() => useSellPackage(scope), { wrapper: clientWrapper(newClient()) });
  await act(async () => {
    await hook.result.current.mutateAsync(body);
  });
  // Only the refused reservation write ran; the accepted sale was not written back.
  expect(setItem).toHaveBeenCalledTimes(1);
  expect(hook.result.current.journalUnsaved).toBe(true);
  expect(hook.result.current.restoredSaleId).toBe(acceptedSaleId);
});
