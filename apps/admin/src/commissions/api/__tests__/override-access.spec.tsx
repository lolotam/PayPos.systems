import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import {
  planEmployeesKey,
  planOverrideHistoryKey,
  planOverrideServicesKey,
  planScope,
  planVersionsKey,
  type PlanScope,
} from '../plan-access';
import { useCommissionOverrideHistory } from '../use-commission-override-history';
import { useCommissionOverrideServices } from '../use-commission-override-services';
import {
  useOverrideAttemptMemory,
  useSaveCommissionOverride,
} from '../use-save-commission-override';
import {
  BUSINESS,
  COMPANY,
  EMP_A,
  employeePage,
  refusal,
  routeGet,
  versionPage,
} from './plan-http';
import {
  CURSOR,
  SERVICE_A,
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
const otherScope = planScope('other-company', 'other-business', 'other-user');

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

/** يزرع قوايم هوية واحدة عشان نلاقيها بعد القفل: الخطط والنسخ وتاريخ الخدمة. */
function seedScope(client: QueryClient, target: PlanScope): void {
  client.setQueryData(planEmployeesKey(target), employeePage([], null));
  client.setQueryData(planVersionsKey(target, EMP_A), versionPage([], null));
  client.setQueryData(planOverrideHistoryKey(target, EMP_A, SERVICE_A), {
    pages: [overridePage([overrideItem(SERVICE_A)], null)],
    pageParams: [undefined],
  });
}

function seedServices(client: QueryClient, target: PlanScope): void {
  client.setQueryData(planOverrideServicesKey(target, EMP_A), {
    pages: [servicePage([serviceItem(SERVICE_A)], null)],
    pageParams: [undefined],
  });
}

function entries(client: QueryClient, target: PlanScope) {
  return {
    employees: client.getQueryData(planEmployeesKey(target)),
    versions: client.getQueryData(planVersionsKey(target, EMP_A)),
    services: client.getQueryData(planOverrideServicesKey(target, EMP_A)),
    history: client.getQueryData(planOverrideHistoryKey(target, EMP_A, SERVICE_A)),
  };
}

function requestedPaths(): string[] {
  return api.GET.mock.calls.map((call) => call[0]);
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

it('a 403 on the first services page closes the whole scope without a request loop', async () => {
  const client = createQueryClient();
  seedScope(client, scope);
  seedScope(client, otherScope);
  seedServices(client, otherScope);
  routeGet(api.GET, async () => refusal(403, 'FORBIDDEN'));
  mount(client);
  await waitFor(() => {
    expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  });
  expect(entries(client, scope)).toEqual({
    employees: undefined,
    versions: undefined,
    services: undefined,
    history: undefined,
  });
  expect(entries(client, otherScope).employees).toBeDefined();
  expect(entries(client, otherScope).versions).toBeDefined();
  expect(entries(client, otherScope).services).toBeDefined();
  expect(entries(client, otherScope).history).toBeDefined();
  const reads = api.GET.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.GET).toHaveBeenCalledTimes(reads);
});

it('a 403 on a later services page closes the whole scope', async () => {
  const client = createQueryClient();
  seedScope(client, scope);
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.cursor === undefined
      ? ok(servicePage([serviceItem(SERVICE_A)], CURSOR))
      : refusal(403, 'FORBIDDEN'),
  );
  const hook = mount(client);
  await waitFor(() => expect(hook.result.current.services.isSuccess).toBe(true));
  act(() => void hook.result.current.services.fetchNextPage());
  await waitFor(() => {
    expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  });
  expect(entries(client, scope).services).toBeUndefined();
  expect(entries(client, scope).history).toBeUndefined();
});

it('a 403 from the history closes the whole scope', async () => {
  const client = createQueryClient();
  seedScope(client, scope);
  routeGet(api.GET, async (path) =>
    path === overrideServicesPath
      ? ok(servicePage([serviceItem(SERVICE_A)], null))
      : refusal(403, 'FORBIDDEN'),
  );
  mount(client);
  await waitFor(() => {
    expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  });
  expect(entries(client, scope).services).toBeUndefined();
  expect(entries(client, scope).history).toBeUndefined();
  expect(requestedPaths()).toContain(
    '/v1/businesses/{businessId}/employees/{employeeId}/commission-overrides',
  );
});

it('a 403 from the save closes the whole scope', async () => {
  const client = createQueryClient();
  seedScope(client, scope);
  const hook = mount(client);
  await waitFor(() => expect(hook.result.current.services.isSuccess).toBe(true));
  api.POST.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
  await act(async () => {
    await expect(
      hook.result.current.save.mutateAsync({
        serviceId: SERVICE_A,
        body: {
          service_id: SERVICE_A,
          rule: { kind: 'PCT', value: 1500 },
          effective_from: '2026-03-01',
        },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  await waitFor(() => {
    expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  });
  expect(entries(client, scope).services).toBeUndefined();
  expect(entries(client, scope).history).toBeUndefined();
  expect(hook.result.current.attempts.current.size).toBe(0);
});
