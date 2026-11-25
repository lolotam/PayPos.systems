import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import { denyPlanAccess, planEmployeesKey, planProbeKey, planScope } from '../plan-access';
import { useCommissionPlanEmployees } from '../use-commission-plan-employees';
import {
  deferredAnswer,
  EMP_A,
  EMP_B,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
  refusal,
  routeGet,
} from './plan-http';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const scope = planScope('company', 'business', 'user');

function mount(client: QueryClient, probe = false) {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(() => useCommissionPlanEmployees(scope, probe ? { probe: true } : undefined), {
    wrapper,
  });
}

beforeEach(() => {
  api.GET.mockReset();
});

it('pages the employee list by the cursor the server hands out', async () => {
  const first = deferredAnswer();
  const second = deferredAnswer();
  routeGet(api.GET, async (path, options) => {
    expect(path).toBe(employeesPath);
    return options?.params?.query?.cursor === undefined ? first.promise : second.promise;
  });
  const hook = mount(createQueryClient());
  first.resolve(ok(employeePage([employeeItem(EMP_A, 7, 'سارة', 'Sara')], 'cursor-1')));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.pages[0]?.items[0]?.name_en).toBe('Sara');
  act(() => void hook.result.current.fetchNextPage());
  second.resolve(ok(employeePage([employeeItem(EMP_B, 9, null, 'Nada')], null)));
  await waitFor(() => expect(hook.result.current.data?.pages.length).toBe(2));
  expect(api.GET).toHaveBeenLastCalledWith(
    employeesPath,
    expect.objectContaining({
      params: expect.objectContaining({
        header: { 'x-company-id': 'company' },
        path: { businessId: 'business' },
        query: { limit: 50, cursor: 'cursor-1' },
      }),
    }),
  );
  expect(hook.result.current.data?.pages[1]?.items[0]?.employee_number).toBe(9);
});

it('a 403 on any page closes the scope and stops asking without a request loop', async () => {
  const client = createQueryClient();
  const first = deferredAnswer();
  const second = deferredAnswer();
  routeGet(api.GET, async (_path, options) =>
    options?.params?.query?.cursor === undefined ? first.promise : second.promise,
  );
  const hook = mount(client);
  first.resolve(ok(employeePage([employeeItem(EMP_A, 7, 'سارة', 'Sara')], 'cursor-1')));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  act(() => void hook.result.current.fetchNextPage());
  second.resolve(refusal(403, 'FORBIDDEN'));
  await waitFor(() => {
    expect(client.getQueryData([...scope, 'access'])).toMatchObject({
      denied: true,
      generation: 1,
    });
  });
  await waitFor(() => expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined());
  expect(api.GET).toHaveBeenCalledTimes(2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.GET).toHaveBeenCalledTimes(2);
});

it('a 503 cursor refusal carries its own code instead of looking like an empty list', async () => {
  const first = deferredAnswer();
  routeGet(api.GET, async () => first.promise);
  const hook = mount(createQueryClient());
  first.resolve(refusal(503, 'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE'));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect((hook.result.current.error as { code?: string }).code).toBe(
    'COMMISSION_PLAN_EMPLOYEE_CURSOR_UNAVAILABLE',
  );
  expect(hook.result.current.data).toBeUndefined();
});

it('ignores an answer that lands after the scope generation moved', async () => {
  const client = createQueryClient();
  const first = deferredAnswer();
  routeGet(api.GET, async () => first.promise);
  const hook = mount(client);
  await denyPlanAccess(client, scope);
  first.resolve(ok(employeePage([employeeItem(EMP_A, 7, 'سارة', 'Sara')], null)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(hook.result.current.data).toBeUndefined();
  expect(api.GET).toHaveBeenCalledTimes(1);
});

it('the nav probe asks for one row only and keeps it under the probe key', async () => {
  const client = createQueryClient();
  const first = deferredAnswer();
  routeGet(api.GET, async () => first.promise);
  const hook = mount(client, true);
  first.resolve(ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null)));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

  expect(api.GET).toHaveBeenCalledWith(
    employeesPath,
    expect.objectContaining({
      params: expect.objectContaining({ query: { limit: 1 } }),
    }),
  );
  expect(client.getQueryData(planProbeKey(scope))).toBeDefined();
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
});

it('the screen list satisfies the nav probe without a second request', async () => {
  const client = createQueryClient();
  const first = deferredAnswer();
  routeGet(api.GET, async () => first.promise);
  const hook = mount(client);
  first.resolve(ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null)));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

  expect(api.GET).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(planProbeKey(scope))).toBeDefined();
});

it('the nav probe never asks again after a window focus', async () => {
  const client = createQueryClient();
  const first = deferredAnswer();
  routeGet(api.GET, async () => first.promise);
  const hook = mount(client, true);
  first.resolve(ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null)));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(api.GET).toHaveBeenCalledTimes(1);
});
