import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EmployeeSalarySection } from '../ui/employee-salary-section';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const props = { companyId: id, businessId: id, userId: id, employeeId: id };
const prefix = ['salaries', id, id, id, id];
const key = [...prefix, undefined];
const page = {
  items: [
    {
      id,
      employee_id: id,
      effective_from: '2026-10-03',
      amount: '765.432',
      set_by: id,
      revision: 1,
      reason: 'Synthetic salary',
    },
  ],
  next_cursor: null,
  can_manage: true,
};
function deferred() {
  let resolve!: (result: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <EmployeeSalarySection {...props} />
    </QueryClientProvider>,
  );
  return { client, view };
}
beforeEach(() => api.GET.mockReset());

it('never renders cached salaries or the set form before a fresh successful read on mount', async () => {
  const pending = deferred();
  api.GET.mockReturnValue(pending.promise);
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
  client.setQueryData(key, page);
  const view = render(
    <QueryClientProvider client={client}>
      <EmployeeSalarySection {...props} />
    </QueryClientProvider>,
  );
  expect(api.GET).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.queryByText('765.432')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'salary.set') })).toBeNull();
  await act(async () => pending.resolve({ data: page }));
  await waitFor(() => expect(screen.getByText('765.432')).toBeTruthy());
  expect(client.getQueryCache().find({ queryKey: key })?.isStale()).toBe(true);
  expect(screen.getByRole('button', { name: t('en', 'salary.set') })).toBeTruthy();
  client.setQueryData([...prefix, '2026-01-01'], page);
  view.unmount();
  expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]);
});

it.each([403, 404])(
  'rechecks a reopened editor within 30 s and evicts cached history after %s',
  async (status) => {
    api.GET.mockResolvedValueOnce({ data: page });
    const { client, view } = setup();
    await waitFor(() => expect(screen.getByText('765.432')).toBeTruthy());
    view.rerender(<QueryClientProvider client={client}>{null}</QueryClientProvider>);
    expect(client.getQueryData(key)).toBeUndefined();
    // تمثل نسخة قديمة وصلت من cache آخر؛ لا يجوز اعتبارها إذن قراءة جديداً.
    client.setQueryData(key, page);
    const revoked = deferred();
    api.GET.mockReturnValueOnce(revoked.promise);
    view.rerender(
      <QueryClientProvider client={client}>
        <EmployeeSalarySection {...props} />
      </QueryClientProvider>,
    );
    expect(api.GET).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('765.432')).toBeNull();
    expect(screen.queryByRole('button', { name: t('en', 'salary.set') })).toBeNull();
    await act(async () => revoked.resolve({ error: { code: 'NOT_FOUND' }, response: { status } }));
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]));
    expect(screen.queryByRole('region')).toBeNull();
  },
);

it('cancels a pending salary read on close and cannot refill its cache with a late response', async () => {
  const pending = deferred();
  api.GET.mockReturnValueOnce(pending.promise);
  const { client, view } = setup();
  const signal = api.GET.mock.calls[0]?.[1].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve({ data: page }));
  expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]);
});
