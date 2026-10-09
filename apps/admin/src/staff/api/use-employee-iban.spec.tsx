import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeIbanSection } from '../ui/employee-iban-section';
import { useEmployeeIban } from './use-employee-iban';
const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const props = { companyId: id, businessId: id, userId: id, employeeId: id };
const key = ['employee-iban', id, id, id, id];
const full = {
  status: 'SET',
  iban: 'KW81CBKU0000000000001234560101',
  iban_last4: '0101',
  bank_id: 'kw-cbk',
  holder_name_en: 'SYNTHETIC HOLDER',
  revision: 1,
  set_at: '2026-10-09T12:00:00.000Z',
  set_by: id,
  can_read_full: true,
  can_manage: true,
};
const masked = {
  ...full,
  iban: null,
  bank_id: null,
  holder_name_en: null,
  set_by: null,
  can_read_full: false,
  can_manage: false,
};
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function mount(client = new QueryClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <EmployeeIbanSection {...props} timeZone="Asia/Kuwait" />
    </QueryClientProvider>,
  );
  return { client, view };
}
function mountHook() {
  const client = new QueryClient();
  api.GET.mockImplementation((path: string) =>
    Promise.resolve({ data: path.endsWith('/history') ? { items: [], next_cursor: null } : full }),
  );
  const hook = renderHook(() => useEmployeeIban(id, id, id, id), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { client, ...hook };
}
const input = {
  iban: full.iban,
  bank_id: full.bank_id,
  holder_name_en: full.holder_name_en,
  reason: 'Synthetic change',
  expected_revision: 1,
};
beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
});
it('waits for fresh permission on mount, never requests history for masked readers, and evicts on close', async () => {
  const client = new QueryClient();
  client.setQueryData([...key, 'current'], full);
  const pending = deferred();
  api.GET.mockReturnValue(pending.promise);
  const { view } = mount(client);
  expect(screen.queryByRole('region')).toBeNull();
  await act(async () => pending.resolve({ data: masked }));
  await waitFor(() => expect(screen.getByText('•••• 0101')).toBeTruthy());
  expect(screen.queryByText('SYNTHETIC HOLDER')).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
  expect(api.GET).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
});
it.each([403, 404])('removes sensitive cached data on %s and does not retry', async (status) => {
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status } });
  const client = new QueryClient();
  client.setQueryData([...key, 'current'], full);
  const { view } = mount(client);
  await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]));
  expect(screen.queryByRole('region')).toBeNull();
  expect(api.GET).toHaveBeenCalledTimes(1);
  view.unmount();
});
it('aborts the current read on close and discards a late response', async () => {
  const pending = deferred();
  api.GET.mockReturnValue(pending.promise);
  const { client, view } = mount();
  const signal = api.GET.mock.calls[0]?.[1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ data: full }));
  expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
});
it('hides current full details and evicts every page when history access is revoked', async () => {
  const pending = deferred();
  api.GET.mockImplementation((path: string) =>
    path.endsWith('/history') ? pending.promise : Promise.resolve({ data: full }),
  );
  const { client, view } = mount();
  await waitFor(() => expect(screen.getByText('SYNTHETIC HOLDER')).toBeTruthy());
  await act(async () =>
    pending.resolve({ error: { code: 'NOT_FOUND' }, response: { status: 404 } }),
  );
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
  expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
  view.unmount();
});
it('removes completed mutations with full IBAN data immediately on unmount', async () => {
  api.PUT.mockResolvedValue({ data: full });
  const { client, result, unmount } = mountHook();
  await act(async () => {
    await result.current.save.mutateAsync(input);
  });
  const cache = client.getMutationCache();
  expect(cache.findAll({ mutationKey: [...key, 'set'] })[0]?.state.data).toEqual(full);
  const unrelated = cache.build(client, { mutationKey: ['unrelated'] });
  unmount();
  expect(cache.findAll({ mutationKey: key })).toEqual([]);
  expect(cache.getAll()).toEqual([unrelated]);
  client.clear();
});
it('removes pending mutations on unmount and does not restore a late IBAN response', async () => {
  const pending = deferred();
  api.PUT.mockReturnValue(pending.promise);
  const { client, result, unmount } = mountHook();
  act(() => result.current.save.mutate(input));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(1));
  const cache = client.getMutationCache();
  expect(cache.findAll({ mutationKey: key })).toHaveLength(1);
  unmount();
  expect(cache.findAll({ mutationKey: key })).toEqual([]);
  await act(async () => pending.resolve({ data: full }));
  expect(cache.findAll({ mutationKey: key })).toEqual([]);
  expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
});
it.each([403, 404])('removes saved IBAN mutations when a fresh read returns %s', async (status) => {
  api.PUT.mockResolvedValue({ data: full });
  const { client, result, unmount } = mountHook();
  await act(async () => {
    await result.current.save.mutateAsync(input);
  });
  expect(client.getMutationCache().findAll({ mutationKey: key })).toHaveLength(1);
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status } });
  await act(async () => {
    await result.current.current.refetch();
  });
  await waitFor(() => expect(result.current.accessDenied).toBe(true));
  expect(client.getMutationCache().findAll({ mutationKey: key })).toEqual([]);
  expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
  unmount();
});
it.each([403, 404])('removes mutation variables when saving is denied with %s', async (status) => {
  api.PUT.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status } });
  const { client, result, unmount } = mountHook();
  act(() => result.current.save.mutate(input));
  await waitFor(() => expect(result.current.accessDenied).toBe(true));
  expect(client.getMutationCache().findAll({ mutationKey: key })).toEqual([]);
  expect(client.getQueryCache().findAll({ queryKey: key })).toEqual([]);
  expect(api.PUT).toHaveBeenCalledTimes(1);
  unmount();
});
it('evicts full history and saved IBAN data when a fresh read comes back masked', async () => {
  api.PUT.mockResolvedValue({ data: full });
  const { client, result, unmount } = mountHook();
  await waitFor(() => expect(result.current.history.data).toBeTruthy());
  await act(async () => {
    await result.current.save.mutateAsync(input);
  });
  expect(client.getMutationCache().findAll({ mutationKey: key })).toHaveLength(1);
  api.GET.mockResolvedValue({ data: masked });
  await act(async () => {
    await result.current.current.refetch();
  });
  // الـ observer المعطّل ممكن يرجّع entry فاضي، المهم إن مفيش أي صفحة سجل فيها بيانات.
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: [...key, 'history'] })
        .map((query) => query.state.data),
    ).toEqual([undefined]),
  );
  expect(client.getMutationCache().findAll({ mutationKey: key })).toEqual([]);
  expect(result.current.save.data).toBeUndefined();
  expect(result.current.save.variables).toBeUndefined();
  expect(result.current.current.data?.iban).toBeNull();
  unmount();
});
