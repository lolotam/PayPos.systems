import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { CreateCommissionServiceOverrideInput } from '@pospay/contracts';
import { createQueryClient } from '@/shared/api/query-client';
import { denyPlanAccess, planOverrideServicesKey, planScope } from '../plan-access';
import { useCommissionOverrideHistory } from '../use-commission-override-history';
import { useCommissionOverrideServices } from '../use-commission-override-services';
import {
  useOverrideAttemptMemory,
  useSaveCommissionOverride,
  type OverrideAttemptMemory,
} from '../use-save-commission-override';
import { BUSINESS, COMPANY, EMP_A, deferredAnswer, refusal, routeGet } from './plan-http';
import {
  CURSOR,
  SERVICE_A,
  SERVICE_B,
  ok,
  overrideItem,
  overridePage,
  overrideServicesPath,
  serviceItem,
  servicePage,
} from './override-http';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const scope = planScope(COMPANY, BUSINESS, 'user-a');
const BODY: CreateCommissionServiceOverrideInput = {
  service_id: SERVICE_A,
  rule: { kind: 'PCT', value: 1500 },
  effective_from: '2026-03-01',
};
const CHANGED_BODY: CreateCommissionServiceOverrideInput = {
  ...BODY,
  rule: { kind: 'PCT', value: 700 },
};

function mount(client: QueryClient) {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(
    () => {
      const attempts = useOverrideAttemptMemory();
      const services = useCommissionOverrideServices(scope, EMP_A);
      const history = useCommissionOverrideHistory(scope, EMP_A, SERVICE_A);
      const save = useSaveCommissionOverride(scope, EMP_A, attempts);
      return { services, history, save, attempts };
    },
    { wrapper },
  );
}

function heldKey(memory: OverrideAttemptMemory, serviceId: string): string | null {
  return memory.current.get(`${EMP_A}:${serviceId}`)?.key ?? null;
}

function sentKey(call: number): string | undefined {
  return api.POST.mock.calls[call]?.[1].params.header['Idempotency-Key'];
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
  routeGet(api.GET, async (path) =>
    path === overrideServicesPath
      ? ok(servicePage([serviceItem(SERVICE_A)], null))
      : ok(overridePage([overrideItem(SERVICE_A)], null)),
  );
});

it('reuses the idempotency key for the same body after a network failure', async () => {
  const hook = mount(createQueryClient());
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(
      hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: BODY }),
    ).rejects.toThrow('network died');
  });
  const key = heldKey(hook.result.current.attempts, SERVICE_A);
  expect(key).not.toBeNull();
  api.POST.mockResolvedValueOnce(ok(overrideItem(SERVICE_B)));
  await act(async () => {
    await hook.result.current.save.mutateAsync({
      serviceId: SERVICE_B,
      body: { ...BODY, service_id: SERVICE_B },
    });
  });
  expect(sentKey(1)).not.toBe(key);
  expect(heldKey(hook.result.current.attempts, SERVICE_A)).toBe(key);
  api.POST.mockResolvedValueOnce(ok(overrideItem(SERVICE_A)));
  await act(async () => {
    await hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: BODY });
  });
  expect(sentKey(2)).toBe(key);
  expect(heldKey(hook.result.current.attempts, SERVICE_A)).toBeNull();
});

it('takes a new key for the same service when the body changes', async () => {
  const hook = mount(createQueryClient());
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(
      hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: BODY }),
    ).rejects.toThrow('network died');
  });
  const key = heldKey(hook.result.current.attempts, SERVICE_A);
  api.POST.mockResolvedValueOnce(ok(overrideItem(SERVICE_A)));
  await act(async () => {
    await hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: CHANGED_BODY });
  });
  expect(sentKey(1)).not.toBe(key);
  expect(heldKey(hook.result.current.attempts, SERVICE_A)).toBeNull();
});

it('reads the history from page one again and refetches the loaded table pages', async () => {
  const client = createQueryClient();
  const serviceCursors: (string | undefined)[] = [];
  const historyCursors: (string | undefined)[] = [];
  routeGet(api.GET, async (path, options) => {
    const raw = options?.params?.query?.cursor;
    const cursor = typeof raw === 'string' ? raw : undefined;
    if (path === overrideServicesPath) {
      serviceCursors.push(cursor);
      return ok(
        servicePage(
          cursor === undefined ? [serviceItem(SERVICE_A)] : [serviceItem(SERVICE_B)],
          cursor === undefined ? CURSOR : null,
        ),
      );
    }
    historyCursors.push(cursor);
    return ok(overridePage([overrideItem(SERVICE_A)], null));
  });
  const hook = mount(client);
  await waitFor(() => expect(hook.result.current.services.isSuccess).toBe(true));
  act(() => void hook.result.current.services.fetchNextPage());
  await waitFor(() => expect(hook.result.current.services.data?.pages.length).toBe(2));
  api.POST.mockResolvedValueOnce(ok(overrideItem(SERVICE_A)));
  await act(async () => {
    await hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: BODY });
  });
  expect(historyCursors).toEqual([undefined, undefined]);
  expect(serviceCursors).toEqual([undefined, CURSOR, undefined, CURSOR]);
  expect(hook.result.current.services.data?.pages.length).toBe(2);
  expect(hook.result.current.services.data?.pages[1]?.items[0]?.service_id).toBe(SERVICE_B);
  expect(heldKey(hook.result.current.attempts, SERVICE_A)).toBeNull();
});

it('a 403 closes the whole scope and clears the held attempt', async () => {
  const client = createQueryClient();
  const hook = mount(client);
  await waitFor(() => expect(hook.result.current.services.isSuccess).toBe(true));
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(
      hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: BODY }),
    ).rejects.toThrow('network died');
  });
  expect(heldKey(hook.result.current.attempts, SERVICE_A)).not.toBeNull();
  api.POST.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
  await act(async () => {
    await expect(
      hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: BODY }),
    ).rejects.toMatchObject({ status: 403 });
  });
  expect(hook.result.current.attempts.current.size).toBe(0);
  await waitFor(() => {
    expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  });
  expect(client.getQueryData(planOverrideServicesKey(scope, EMP_A))).toBeUndefined();
});

it('a late answer after the scope generation moved changes nothing', async () => {
  const client = createQueryClient();
  const deferred = deferredAnswer();
  const hook = mount(client);
  await waitFor(() => expect(hook.result.current.services.isSuccess).toBe(true));
  api.POST.mockReturnValueOnce(deferred.promise);
  const pending = act(async () => {
    await hook.result.current.save.mutateAsync({ serviceId: SERVICE_A, body: BODY });
  });
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  await act(async () => {
    await denyPlanAccess(client, scope);
  });
  const readsBefore = api.GET.mock.calls.length;
  deferred.resolve(ok(overrideItem(SERVICE_A)));
  await pending;
  expect(api.GET).toHaveBeenCalledTimes(readsBefore);
});
