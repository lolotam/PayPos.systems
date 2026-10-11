import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { reportFixture, reportMonth, reportScope } from './attendance-report.fixture';
import { useAttendanceReport } from './use-attendance-report';
import { useAttendanceReportCsv } from './use-attendance-report-csv';
const fetcher = vi.fn<(request: Request) => Promise<Response>>();
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([reportScope.branchId, 'all'])(
  'sends JSON and CSV requests to the actual generated client URLs for %s',
  async (branchId) => {
    fetcher.mockReset();
    fetcher.mockImplementation(async (request: Request) =>
      request.url.includes('.csv')
        ? new Response(String.fromCharCode(0xfeff) + 'synthetic,csv', {
            headers: { 'content-type': 'text/csv' },
          })
        : new Response(JSON.stringify(reportFixture), {
            headers: { 'content-type': 'application/json' },
          }),
    );
    vi.stubGlobal('fetch', fetcher);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:synthetic'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () => ({
        report: useAttendanceReport({ ...reportScope, branchId }, reportMonth),
        csv: useAttendanceReportCsv({ ...reportScope, branchId }, reportMonth, 'Synthetic branch'),
      }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.report.isSuccess).toBe(true));
    await act(async () => {
      await hook.result.current.csv.mutateAsync();
    });
    const base =
      `http://127.0.0.1:3000/v1/businesses/${reportScope.businessId}` +
      (branchId === 'all' ? '' : `/branches/${branchId}`);
    expect(fetcher.mock.calls.map(([request]) => request.url)).toEqual([
      `${base}/attendance-report?month=${reportMonth}`,
      `${base}/attendance-report.csv?month=${reportMonth}`,
    ]);
    for (const [request] of fetcher.mock.calls) {
      expect(request.credentials).toBe('include');
      expect(request.headers.get('x-company-id')).toBe(reportScope.companyId);
    }
    hook.unmount();
    client.clear();
  },
);
