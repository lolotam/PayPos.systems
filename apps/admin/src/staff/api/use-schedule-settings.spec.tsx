import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useScheduleSettings, useSetScheduleSettings } from './use-schedule-settings';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
const id = '01920000-0000-7000-8000-000000000101';
const other = '01920000-0000-7000-8000-000000000102';
const scope = { companyId: id, businessId: id, branchId: id, userId: id };
const data = { business_id: id, max_shifts_per_day: 3, is_default: true, updated_at: null };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
it('isolates settings reads by company, business and user and preserves forbidden responses', async () => {
  api.GET.mockReset().mockResolvedValue({ data });
  const { client, wrapper } = setup();
  const hook = renderHook(({ userId }) => useScheduleSettings({ ...scope, userId }), {
    wrapper,
    initialProps: { userId: id },
  });
  await waitFor(() => expect(hook.result.current.data).toEqual(data));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/schedule-settings',
    expect.objectContaining({
      params: { header: { 'x-company-id': id }, path: { businessId: id } },
    }),
  );
  const error = { code: 'FORBIDDEN', message_ar: 'Synthetic', message_en: 'Synthetic' };
  api.GET.mockResolvedValue({ error });
  hook.rerender({ userId: other });
  await waitFor(() => expect(hook.result.current.error).toEqual(error));
  expect(hook.result.current.data).toBeUndefined();
  expect(client.getQueryData(['schedule-settings', id, id, id])).toEqual(data);
  expect(api.GET).toHaveBeenCalledTimes(2);
});
it('refreshes all affected schedule/template pages in the saved business after a scope change', async () => {
  let resolve!: (value: { data: typeof data }) => void;
  api.PUT.mockReset().mockReturnValue(
    new Promise<{ data: typeof data }>((done) => {
      resolve = done;
    }),
  );
  const { client, wrapper } = setup();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(({ businessId }) => useSetScheduleSettings({ ...scope, businessId }), {
    wrapper,
    initialProps: { businessId: id },
  });
  let saving!: Promise<unknown>;
  act(() => {
    saving = hook.result.current.mutateAsync({ max_shifts_per_day: 4 });
  });
  await waitFor(() => expect(api.PUT).toHaveBeenCalledOnce());
  hook.rerender({ businessId: other });
  await act(async () => {
    resolve({ data: { ...data, max_shifts_per_day: 4, is_default: false } });
    await saving;
  });
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: ['schedule-settings', id, id, id] }],
    [{ queryKey: ['schedules', id, id] }],
    [{ queryKey: ['shift-templates', id, id] }],
  ]);
});
