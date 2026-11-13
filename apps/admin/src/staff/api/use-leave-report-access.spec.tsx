import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { leaveId } from './leave-decision.fixture';
import { historyPage } from './leave-history.fixture';
import { envelopeFailure, requiredRefusal } from './leave-report.fixture';
import { useLeaveReportAccess } from './use-leave-report-access';

const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));

function probe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useLeaveReportAccess(leaveId, leaveId, 'user'), { wrapper });
}

beforeEach(() => {
  api.GET.mockReset();
});

it('allows the entry when the probe read succeeds', async () => {
  api.GET.mockResolvedValue({ data: historyPage() });
  const hook = probe();
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.allowed).toBe(true);
});

it('allows the entry when the heavy report refusal answers the probe', async () => {
  api.GET.mockResolvedValue(requiredRefusal());
  const hook = probe();
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.allowed).toBe(true);
});

it('refuses the entry when the probe answers 404', async () => {
  api.GET.mockResolvedValue(envelopeFailure(404, 'NOT_FOUND'));
  const hook = probe();
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.allowed).toBe(false);
});

it('refuses the entry when the feature is disabled', async () => {
  api.GET.mockResolvedValue(envelopeFailure(403, 'FEATURE_DISABLED'));
  const hook = probe();
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(hook.result.current.allowed).toBe(false);
});

it('probes one fixed day with a single row', async () => {
  api.GET.mockResolvedValue({ data: historyPage() });
  probe();
  await waitFor(() => expect(api.GET).toHaveBeenCalled());
  expect(api.GET).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/leave-history',
    expect.objectContaining({
      params: expect.objectContaining({
        query: { from: '2000-01-01', to: '2000-01-01', limit: 1 },
      }),
    }),
  );
});

it('does not read the probe again when the window regains focus', async () => {
  api.GET.mockResolvedValue({ data: historyPage() });
  const hook = probe();
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(api.GET).toHaveBeenCalledTimes(1);
  expect(hook.result.current.isSuccess).toBe(true);
});
