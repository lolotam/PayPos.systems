import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { reportFixture, reportMonth, reportScope } from './attendance-report.fixture';
import { useAttendanceReport } from './use-attendance-report';
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
beforeEach(() => {
  api.GET.mockReset();
  api.GET.mockResolvedValue({ data: reportFixture });
});
function setup(branchId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(({ month }) => useAttendanceReport({ ...reportScope, branchId }, month), {
    wrapper,
    initialProps: { month: reportMonth },
  });
  return { client, ...hook };
}
it.each([reportScope.branchId, 'all'])(
  'loads the selected month with scope %s and removes private cache on close',
  async (branchId) => {
    const hook = setup(branchId);
    await waitFor(() => expect(hook.result.current.data).toEqual(reportFixture));
    expect(api.GET).toHaveBeenCalledWith(
      branchId === 'all'
        ? '/v1/businesses/{businessId}/attendance-report'
        : '/v1/businesses/{businessId}/branches/{branchId}/attendance-report',
      {
        params: {
          header: { 'x-company-id': reportScope.companyId },
          path: { businessId: reportScope.businessId, ...(branchId === 'all' ? {} : { branchId }) },
          query: { month: reportMonth },
        },
        signal: expect.any(AbortSignal),
      },
    );
    hook.rerender({ month: '2026-09' });
    await waitFor(() =>
      expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ month: '2026-09' }),
    );
    hook.unmount();
    expect(hook.client.getQueryCache().findAll({ queryKey: ['attendance-report'] })).toEqual([]);
    hook.client.clear();
  },
);
it('preserves server refusal code and status for the screen', async () => {
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  const hook = setup('all');
  await waitFor(() =>
    expect(hook.result.current.error).toEqual({ code: 'NOT_FOUND', status: 404 }),
  );
  hook.unmount();
  hook.client.clear();
});
it('validates report responses and never substitutes client totals', async () => {
  api.GET.mockResolvedValue({
    data: { ...reportFixture, rows: [{ ...reportFixture.rows[0], worked_minutes: -1 }] },
  });
  const hook = setup(reportScope.branchId);
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.data).toBeUndefined();
  await act(async () => {
    await hook.result.current.refetch();
  });
  hook.unmount();
  hook.client.clear();
});
