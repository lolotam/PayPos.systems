import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeePasskeySection } from '../ui/employee-passkey-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const props = {
  companyId: id,
  businessId: id,
  userId: id,
  employeeId: id,
  timeZone: 'Asia/Kuwait',
};
const prefix = ['employee-passkeys', id, id, id, id];
const page = {
  status: { bound: true, binding_id: id, revision: 1, bound_at: '2026-10-04T10:00:00Z' },
  can_unbind: true,
  items: [{ binding_id: id, revision: 1, bound_at: '2026-10-04T10:00:00Z', unbound_at: null }],
  next_cursor: null,
};
beforeEach(() => {
  api.GET.mockReset();
  api.POST.mockReset();
});
function view(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <EmployeePasskeySection {...props} />
    </QueryClientProvider>
  );
}
function deferred() {
  let resolve!: (value: unknown) => void;
  return {
    promise: new Promise((done) => {
      resolve = done;
    }),
    resolve: (value: unknown) => resolve(value),
  };
}

it('hides cached authority until a fresh read; revocation and close evict history', async () => {
  const pending = deferred();
  api.GET.mockReturnValueOnce(pending.promise);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([...prefix, undefined], page);
  const mounted = render(view(client));
  expect(screen.queryByRole('region')).toBeNull();
  await act(async () => pending.resolve({ data: page }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: t('en', 'passkeyAdmin.unbind') })).toBeTruthy(),
  );
  api.GET.mockResolvedValueOnce({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  await act(async () => {
    await client.invalidateQueries({ queryKey: prefix });
  });
  await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]));
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe(t('en', 'passkeyAdmin.unavailable'));
  mounted.unmount();
});

it('a disabled staff feature shows its own state instead of an empty space', async () => {
  api.GET.mockResolvedValueOnce({
    error: { code: 'FEATURE_DISABLED' },
    response: { status: 403 },
  });
  render(view(new QueryClient({ defaultOptions: { queries: { retry: false } } })));
  expect((await screen.findByRole('status')).textContent).toBe(t('en', 'passkeyAdmin.disabled'));
  expect(screen.queryByRole('region')).toBeNull();
});

it('a background refetch keeps the unbind form and the typed reason', async () => {
  api.GET.mockResolvedValueOnce({ data: page });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(view(client));
  const reason = await screen.findByLabelText(t('en', 'passkeyAdmin.reason'));
  fireEvent.change(reason, { target: { value: 'Synthetic lost phone' } });
  const pending = deferred();
  api.GET.mockReturnValueOnce(pending.promise);
  void client.refetchQueries({ queryKey: prefix });
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText<HTMLInputElement>(t('en', 'passkeyAdmin.reason')).value).toBe(
    'Synthetic lost phone',
  );
  await act(async () => pending.resolve({ data: page }));
  expect(screen.getByLabelText<HTMLInputElement>(t('en', 'passkeyAdmin.reason')).value).toBe(
    'Synthetic lost phone',
  );
});

it('requires a trimmed reason, sends the displayed binding revision and refreshes after unbind', async () => {
  api.GET.mockResolvedValueOnce({ data: page });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(view(client));
  const button = await screen.findByRole('button', { name: t('en', 'passkeyAdmin.unbind') });
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(api.POST).not.toHaveBeenCalled();
  api.POST.mockResolvedValue({
    data: { binding_id: id, revision: 2, unbound_at: '2026-10-04T11:00:00Z' },
  });
  api.GET.mockResolvedValue({
    data: {
      ...page,
      status: { bound: false, binding_id: null, revision: null, bound_at: null },
      items: [],
    },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'passkeyAdmin.reason')), {
    target: { value: '  Synthetic replacement  ' },
  });
  fireEvent.click(button);
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(1));
  expect(api.POST.mock.calls[0]?.[1]).toMatchObject({
    body: { binding_id: id, revision: 1, reason: 'Synthetic replacement' },
  });
  await screen.findByText(t('en', 'passkeyAdmin.notBound'));
  expect(api.GET).toHaveBeenCalledTimes(2);
});

it('history-only authority shows no unbind action and closing cancels pending reads', async () => {
  api.GET.mockResolvedValueOnce({ data: { ...page, can_unbind: false } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const mounted = render(view(client));
  await screen.findByRole('region');
  expect(screen.queryByRole('button', { name: t('en', 'passkeyAdmin.unbind') })).toBeNull();
  const pending = deferred();
  api.GET.mockReturnValueOnce(pending.promise);
  void client.invalidateQueries({ queryKey: prefix });
  await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
  const signal = api.GET.mock.calls[1]?.[1].signal as AbortSignal;
  mounted.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ data: page }));
  expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]);
});
