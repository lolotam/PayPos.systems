import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EmployeeLeaveSection } from '../ui/employee-leave-section';
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const id = '01920000-0000-7000-8000-0000000000a2';
const props = {
  companyId: id,
  businessId: id,
  userId: id,
  employeeId: id,
  branches: [
    {
      id,
      name_en: 'Synthetic branch',
      name_ar: null,
      is_active: true,
      effective_timezone: 'Asia/Kuwait',
    },
  ],
};
const prefix = ['leave', id, id, id, id],
  key = [...prefix, undefined];
it.each([403, 404])(
  'requires a fresh read and evicts scoped history on %s and close',
  async (status) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cached = { items: [], next_cursor: null, request_branch_ids: [id] };
    client.setQueryData(key, cached);
    let done!: (value: unknown) => void;
    api.GET.mockReturnValue(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    const view = render(
      <QueryClientProvider client={client}>
        <EmployeeLeaveSection {...props} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: t('en', 'leave.submit') })).toBeNull();
    await act(async () => done({ error: { code: 'NOT_FOUND' }, response: { status } }));
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: prefix })).toEqual([]));
    expect(screen.queryByRole('region')).toBeNull();
    view.unmount();
    expect(client.getQueryData(key)).toBeUndefined();
  },
);
it('a reader without create authority sees history but no on-behalf form', async () => {
  api.GET.mockResolvedValue({ data: { items: [], next_cursor: null, request_branch_ids: [] } });
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <EmployeeLeaveSection {...props} />
    </QueryClientProvider>,
  );
  await screen.findByRole('region');
  expect(screen.queryByRole('button', { name: t('en', 'leave.submit') })).toBeNull();
  view.unmount();
});
