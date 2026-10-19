import type { ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSetEmployeeNumber } from './use-set-employee-number';

const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PUT: put }) }));
const id = '01920000-0000-7000-8000-0000000000a2';

function renderNumber(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSetEmployeeNumber(id, id, id, id), { wrapper });
}

it('drops inactive attendance and performer caches after a saved number', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const performers = ['session-performers', id, 'inactive'];
  const facts = ['session-performer-facts', id, 'inactive'];
  const attendance = ['attendance-actions', id, id, id, id, 'employees', '', undefined];
  client.setQueryData(performers, { items: [{ id, employee_number: 4 }] });
  client.setQueryData(facts, { items: [{ id, employee_number: 4 }] });
  client.setQueryData(attendance, { pages: [{ items: [{ employee_number: 4 }] }] });
  const active = ['session-performers', id, 'active'];
  client.setQueryData(active, { items: [{ id, employee_number: 4 }] });
  function Watch() {
    useQuery({ queryKey: active, queryFn: () => new Promise(() => undefined) });
    return null;
  }
  put.mockResolvedValue({ data: { employee_id: id, employee_number: 7 } });
  const hook = renderNumber(client);
  const view = renderHook(() => null, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <Watch />
        {children}
      </QueryClientProvider>
    ),
  });
  await act(async () => {
    await hook.result.current.mutateAsync(7);
  });
  expect(client.getQueryData(performers)).toBeUndefined();
  expect(client.getQueryData(facts)).toBeUndefined();
  expect(client.getQueryData(attendance)).toBeUndefined();
  expect(client.getQueryState(active)?.isInvalidated).toBe(true);
  view.unmount();
});

it('invalidates number capability after a forbidden edit', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const capability = ['employee-number-capability', id, id, id];
  client.setQueryData(capability, { can_type_number: true });
  const refusal = {
    code: 'FORBIDDEN',
    message_en: 'Synthetic refusal',
    message_ar: t('ar', 'errors.FORBIDDEN'),
  };
  put.mockResolvedValueOnce({ error: refusal });
  const hook = renderNumber(client);
  await act(async () => {
    await expect(hook.result.current.mutateAsync(7)).rejects.toEqual(refusal);
  });
  expect(client.getQueryState(capability)?.isInvalidated).toBe(true);
});

function hangFirst(stale: unknown) {
  let seen = 0;
  let release: ((value: unknown) => void) | undefined;
  return {
    queryFn: () => {
      seen += 1;
      const call = seen;
      return new Promise((resolve) => {
        if (call === 1) release = resolve;
      });
    },
    seen: () => seen,
    releaseFirst: () => release?.(stale),
  };
}

it('keeps the saved number when an older read resolves after the save', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const detailKey = ['employees', id, id, id, 'detail', id] as const;
  const listKey = ['employees', id, id, id, 'list', undefined] as const;
  const staleDetail = { id, employee_number: 4 };
  const staleList = {
    items: [{ id, name_en: 'Synthetic', name_ar: null, employee_number: 4 }],
    next_cursor: null,
  };
  client.setQueryData(detailKey, staleDetail);
  client.setQueryData(listKey, staleList);
  const detailRead = hangFirst(staleDetail);
  const listRead = hangFirst(staleList);
  function Watch() {
    useQuery({ queryKey: detailKey, queryFn: detailRead.queryFn });
    useQuery({ queryKey: listKey, queryFn: listRead.queryFn });
    return null;
  }
  put.mockResolvedValue({ data: { employee_id: id, employee_number: 7 } });
  const hook = renderNumber(client);
  const view = renderHook(() => null, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <Watch />
        {children}
      </QueryClientProvider>
    ),
  });
  await waitFor(() => {
    expect(detailRead.seen()).toBe(1);
    expect(listRead.seen()).toBe(1);
  });
  await act(async () => {
    await hook.result.current.mutateAsync(7);
  });
  expect(detailRead.seen()).toBeGreaterThanOrEqual(2);
  expect(listRead.seen()).toBeGreaterThanOrEqual(2);
  detailRead.releaseFirst();
  listRead.releaseFirst();
  await act(async () => {
    await Promise.resolve();
  });
  expect(client.getQueryData<{ employee_number: number }>(detailKey)?.employee_number).toBe(7);
  expect(
    client.getQueryData<{ items: { employee_number: number }[] }>(listKey)?.items[0]
      ?.employee_number,
  ).toBe(7);
  expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
  view.unmount();
});

it('updates each staff list by its own search and refetches an active list', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const other = '01920000-0000-7000-8000-0000000000b2';
  const heba = { id, name_en: 'Heba 12', name_ar: null, employee_number: 4 };
  const sara = { id: other, name_en: 'Sara', name_ar: null, employee_number: 5 };
  const page = (items: readonly { id: string; employee_number: number }[]) => ({
    items,
    next_cursor: null,
  });
  const root = ['employees', id, id, id, 'list'] as const;
  const all = [...root, undefined] as const;
  const byNumber = [...root, undefined, '4'] as const;
  const byName = [...root, undefined, 'Heba'] as const;
  const byNameDigits = [...root, undefined, '12'] as const;
  const inactiveNew = [...root, undefined, '7'] as const;
  client.setQueryData(all, page([heba, sara]));
  client.setQueryData(byNumber, page([heba]));
  client.setQueryData(byName, page([heba]));
  client.setQueryData(byNameDigits, page([heba]));
  client.setQueryData(inactiveNew, page([sara]));
  let fetches = 0;
  function Watch() {
    useQuery({
      queryKey: byNumber,
      queryFn: () => {
        fetches += 1;
        return new Promise(() => undefined);
      },
    });
    return null;
  }
  put.mockResolvedValue({ data: { employee_id: id, employee_number: 7 } });
  const hook = renderNumber(client);
  const view = renderHook(() => null, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <Watch />
        {children}
      </QueryClientProvider>
    ),
  });
  await waitFor(() => expect(fetches).toBe(1));
  await act(async () => {
    await hook.result.current.mutateAsync(7);
  });
  const numberOf = (key: readonly unknown[]) =>
    client
      .getQueryData<{ items: { id: string; employee_number: number }[] }>(key)
      ?.items.find((item) => item.id === id)?.employee_number;
  expect(numberOf(all)).toBe(7);
  expect(numberOf(byName)).toBe(7);
  expect(numberOf(byNameDigits)).toBe(7);
  expect(client.getQueryData<{ items: unknown[] }>(byNumber)?.items).toEqual([]);
  expect(client.getQueryData(inactiveNew)).toBeUndefined();
  expect(fetches).toBeGreaterThanOrEqual(2);
  expect(client.getQueryState(byNumber)?.isInvalidated).toBe(true);
  view.unmount();
});
