import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useScheduleSave, useScheduleWeek } from './use-schedules';
const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
const id = '01920000-0000-7000-8000-000000000101';
const other = '01920000-0000-7000-8000-000000000102';
const scope = { companyId: id, businessId: id, branchId: id, userId: id };
const week = '2026-10-03';
const data = {
  max_shifts_per_day: 3,
  week_start: week,
  timezone: 'Asia/Kuwait',
  days: [
    '2026-10-03',
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
  ],
  items: [],
  next_cursor: null,
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
it('uses generated paths, cursor and company/business/branch/user/week cache keys', async () => {
  api.GET.mockResolvedValue({ data });
  const { client, wrapper } = setup();
  const hook = renderHook(
    ({ companyId }) => useScheduleWeek({ ...scope, companyId }, week, other),
    { wrapper, initialProps: { companyId: id } },
  );
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/schedules',
    expect.objectContaining({
      params: {
        header: { 'x-company-id': id },
        path: { businessId: id, branchId: id },
        query: { week_start: week, limit: 20, cursor: other },
      },
    }),
  );
  hook.rerender({ companyId: other });
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ).toContainEqual(['schedules', other, id, id, id, week, other]),
  );
});
it('sends the read revision and preserves a conflict without retrying', async () => {
  const error = {
    code: 'SCHEDULE_REVISION_CONFLICT',
    message_ar: 'Synthetic conflict',
    message_en: 'Synthetic conflict',
  };
  api.PUT.mockReset().mockResolvedValue({ error });
  const { wrapper } = setup();
  const hook = renderHook(() => useScheduleSave(scope, id), { wrapper });
  const input = { week_start: week, expected_revision: 2, shifts: [], reason: undefined };
  await act(async () => {
    await expect(hook.result.current.mutateAsync(input)).rejects.toEqual(error);
  });
  expect(api.PUT).toHaveBeenCalledOnce();
  expect(api.PUT).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/branches/{branchId}/schedules/{employeeId}',
    {
      params: {
        header: { 'x-company-id': id },
        path: { businessId: id, branchId: id, employeeId: id },
      },
      body: { week_start: week, expected_revision: 2, shifts: [] },
    },
  );
});
