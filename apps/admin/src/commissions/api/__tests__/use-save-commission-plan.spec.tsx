import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/shared/api/query-client';
import { planEmployeesKey, planScope, planVersionsKey } from '../plan-access';
import {
  usePlanAttemptMemory,
  useSaveCommissionPlan,
  type PlanAttemptMemory,
} from '../use-save-commission-plan';
import {
  BUSINESS,
  COMPANY,
  EMP_A,
  employeePage,
  ok,
  refusal,
  versionItem,
  versionPage,
} from './plan-http';
import type { CreateCommissionPlanVersionInput } from '@pospay/contracts';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

const scope = planScope(COMPANY, BUSINESS, 'user-a');
const EMP = EMP_A;
const BODY: CreateCommissionPlanVersionInput = {
  effective_from: '2026-03-01',
  whole_period: false,
  base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
  tiers: { enabled: false },
  package_sale: { enabled: false },
};
const CHANGED_BODY: CreateCommissionPlanVersionInput = {
  ...BODY,
  base: { enabled: true, calc: { kind: 'PCT', bps: 700 } },
};

function mount(client: QueryClient, employeeId = EMP, memory?: PlanAttemptMemory) {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(
    () => {
      const attempts = memory ?? usePlanAttemptMemory();
      const save = useSaveCommissionPlan(scope, employeeId, attempts);
      return { save, attempts };
    },
    { wrapper },
  );
}

function readKey(memory: PlanAttemptMemory, employeeId: string) {
  return memory.current.get(employeeId)?.key ?? null;
}

beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
});

it('reuses the idempotency key for the same body after a network failure', async () => {
  const hook = mount(createQueryClient());
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(hook.result.current.save.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  const heldKey = readKey(hook.result.current.attempts, EMP);
  expect(heldKey).not.toBeNull();
  api.POST.mockResolvedValueOnce(ok(versionItem(EMP, 1)));
  await act(async () => {
    await hook.result.current.save.mutateAsync(BODY);
  });
  expect(api.POST.mock.calls[1]?.[1].params.header['Idempotency-Key']).toBe(heldKey);
  expect(readKey(hook.result.current.attempts, EMP)).toBeNull();
});

it('still reuses the key after switching to another employee and back', async () => {
  const client = createQueryClient();
  const first = mount(client);
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(first.result.current.save.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  const memory = first.result.current.attempts;
  const heldKey = readKey(memory, EMP);
  first.unmount();
  const back = mount(client, EMP, memory);
  api.POST.mockResolvedValueOnce(ok(versionItem(EMP, 1)));
  await act(async () => {
    await back.result.current.save.mutateAsync(BODY);
  });
  expect(api.POST.mock.calls[1]?.[1].params.header['Idempotency-Key']).toBe(heldKey);
  expect(readKey(memory, EMP)).toBeNull();
});

it('a changed body takes a new key for the same employee', async () => {
  const hook = mount(createQueryClient());
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(hook.result.current.save.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  const heldKey = readKey(hook.result.current.attempts, EMP);
  api.POST.mockResolvedValueOnce(ok(versionItem(EMP, 1)));
  await act(async () => {
    await hook.result.current.save.mutateAsync(CHANGED_BODY);
  });
  expect(api.POST.mock.calls[1]?.[1].params.header['Idempotency-Key']).not.toBe(heldKey);
  expect(readKey(hook.result.current.attempts, EMP)).toBeNull();
});

it('a 403 clears the held key and closes the whole scope', async () => {
  const client = createQueryClient();
  client.setQueryData(planEmployeesKey(scope), employeePage([], null));
  client.setQueryData(planVersionsKey(scope, EMP), versionPage([], null));
  const hook = mount(client);
  api.POST.mockResolvedValueOnce(refusal(403, 'FORBIDDEN'));
  await act(async () => {
    await expect(hook.result.current.save.mutateAsync(BODY)).rejects.toMatchObject({ status: 403 });
  });
  expect(hook.result.current.attempts.current.size).toBe(0);
  await waitFor(() => {
    expect(client.getQueryData([...scope, 'access'])).toMatchObject({ denied: true });
  });
  expect(client.getQueryData(planEmployeesKey(scope))).toBeUndefined();
  expect(client.getQueryData(planVersionsKey(scope, EMP))).toBeUndefined();
});

it('an identity change starts from an empty memory with a fresh key', async () => {
  const client = createQueryClient();
  const first = mount(client);
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(first.result.current.save.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  const heldKey = readKey(first.result.current.attempts, EMP);
  expect(heldKey).not.toBeNull();
  const nextIdentity = mount(client, EMP);
  api.POST.mockResolvedValueOnce(ok(versionItem(EMP, 1)));
  await act(async () => {
    await nextIdentity.result.current.save.mutateAsync(BODY);
  });
  expect(api.POST.mock.calls[1]?.[1].params.header['Idempotency-Key']).not.toBe(heldKey);
});

it('a 404 removes only that employee entry', async () => {
  const client = createQueryClient();
  const memory: PlanAttemptMemory = { current: new Map() };
  const first = mount(client, EMP, memory);
  const second = mount(client, 'emp-2', memory);
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(first.result.current.save.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  api.POST.mockRejectedValueOnce(new Error('network died'));
  await act(async () => {
    await expect(second.result.current.save.mutateAsync(BODY)).rejects.toThrow('network died');
  });
  expect(memory.current.size).toBe(2);
  api.POST.mockResolvedValueOnce(refusal(404, 'EMPLOYEE_NOT_FOUND'));
  await act(async () => {
    await expect(first.result.current.save.mutateAsync(BODY)).rejects.toMatchObject({
      status: 404,
    });
  });
  expect(readKey(memory, 'emp-2')).not.toBeNull();
  expect(readKey(memory, EMP)).toBeNull();
});

it('a successful save puts the stored version first on the first history page without a refetch', async () => {
  const client = createQueryClient();
  client.setQueryData(planVersionsKey(scope, EMP), {
    pages: [versionPage([versionItem(EMP, 3)], null)],
    pageParams: [undefined],
  });
  const hook = mount(client);
  api.POST.mockResolvedValueOnce(ok(versionItem(EMP, 4)));
  const readsBefore = api.GET.mock.calls.length;
  await act(async () => {
    await hook.result.current.save.mutateAsync(BODY);
  });
  const history = client.getQueryData(planVersionsKey(scope, EMP)) as {
    pages: { items: { version: number }[] }[];
  };
  expect(history.pages[0]?.items[0]?.version).toBe(4);
  expect(api.GET.mock.calls.length).toBe(readsBefore);
});
