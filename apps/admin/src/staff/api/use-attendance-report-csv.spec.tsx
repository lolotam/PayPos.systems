import { Blob as NodeBlob } from 'node:buffer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reportMonth, reportScope } from './attendance-report.fixture';
import { useAttendanceReportCsv } from './use-attendance-report-csv';
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
let clicked: { filename: string; href: string } | undefined;
let createUrl: ReturnType<typeof vi.fn>;
let revokeUrl: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clicked = undefined;
  api.GET.mockReset();
  createUrl = vi.fn(() => 'blob:synthetic-csv');
  revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked = { filename: this.download, href: this.href };
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup(branchId: string, branchName = 'Synthetic branch') {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => useAttendanceReportCsv({ ...reportScope, branchId }, reportMonth, branchName),
    {
      wrapper,
    },
  );
  return { client, ...hook };
}
it.each([reportScope.branchId, 'all'])(
  'downloads the server CSV with scope %s and matching filename',
  async (branchId) => {
    vi.useFakeTimers();
    const csv = new Blob([String.fromCharCode(0xfeff), 'synthetic,csv'], { type: 'text/csv' });
    api.GET.mockResolvedValue({ data: csv });
    const hook = setup(branchId);
    await act(async () => {
      await hook.result.current.mutateAsync();
    });
    expect(api.GET).toHaveBeenCalledWith(
      branchId === 'all'
        ? '/v1/businesses/{businessId}/attendance-report.csv'
        : '/v1/businesses/{businessId}/branches/{branchId}/attendance-report.csv',
      {
        params: {
          header: { 'x-company-id': reportScope.companyId },
          path: { businessId: reportScope.businessId, ...(branchId === 'all' ? {} : { branchId }) },
          query: { month: reportMonth },
        },
        parseAs: 'blob',
        signal: expect.any(AbortSignal),
      },
    );
    expect(createUrl).toHaveBeenCalledWith(csv);
    expect(clicked).toEqual({
      filename: `attendance-${branchId === 'all' ? 'all' : 'Synthetic-branch'}-${reportMonth}.csv`,
      href: 'blob:synthetic-csv',
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(revokeUrl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revokeUrl).toHaveBeenCalledWith('blob:synthetic-csv');
    expect(document.querySelector('a[download]')).toBeNull();
    hook.unmount();
    expect(revokeUrl).toHaveBeenCalledTimes(1);
    hook.client.clear();
  },
);
it.each([
  [
    `  ${t('ar', 'attendanceReport.branch')} : * ? " < > | / \\ . `,
    t('ar', 'attendanceReport.branch'),
  ],
  ['Synthetic\nbranch\u0000', 'Synthetic-branch'],
  [' . / * ', 'all'],
])('sanitises branch name %s for the CSV filename', async (branchName, name) => {
  vi.useFakeTimers();
  api.GET.mockResolvedValue({ data: new Blob(['synthetic']) });
  const hook = setup(reportScope.branchId, branchName);
  await act(async () => {
    await hook.result.current.mutateAsync();
  });
  expect(clicked?.filename).toBe(`attendance-${name}-${reportMonth}.csv`);
  hook.unmount();
  hook.client.clear();
});
it('revokes every pending object URL immediately on unmount and cancels delayed cleanup', async () => {
  vi.useFakeTimers();
  createUrl.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  api.GET.mockResolvedValue({ data: new Blob(['synthetic']) });
  const hook = setup(reportScope.branchId);
  await act(async () => {
    await hook.result.current.mutateAsync();
    await hook.result.current.mutateAsync();
  });
  expect(revokeUrl).not.toHaveBeenCalled();
  hook.unmount();
  expect(revokeUrl.mock.calls).toEqual([['blob:first'], ['blob:second']]);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(revokeUrl).toHaveBeenCalledTimes(2);
  hook.client.clear();
});
it('does not download an error response', async () => {
  api.GET.mockResolvedValue({ error: { code: 'FEATURE_DISABLED' }, response: { status: 403 } });
  const hook = setup('all');
  await act(async () => {
    await expect(hook.result.current.mutateAsync()).rejects.toEqual({
      code: 'FEATURE_DISABLED',
      status: 403,
    });
  });
  expect(createUrl).not.toHaveBeenCalled();
  hook.unmount();
  hook.client.clear();
});
it.each([
  ['NOT_FOUND', 404],
  ['FEATURE_DISABLED', 403],
])('preserves %s from a JSON Blob during download', async (code, status) => {
  api.GET.mockResolvedValue({
    error: new NodeBlob([JSON.stringify({ code })], { type: 'application/json' }),
    response: { status },
  });
  const hook = setup('all');
  await act(async () => {
    await expect(hook.result.current.mutateAsync()).rejects.toEqual({ code, status });
  });
  expect(createUrl).not.toHaveBeenCalled();
  expect(clicked).toBeUndefined();
  hook.unmount();
  hook.client.clear();
});
it('uses a generic error for a non-JSON Blob without downloading it', async () => {
  api.GET.mockResolvedValue({
    error: new NodeBlob(['Synthetic outage']),
    response: { status: 502 },
  });
  const hook = setup(reportScope.branchId);
  await act(async () => {
    await expect(hook.result.current.mutateAsync()).rejects.toEqual({ status: 502 });
  });
  expect(createUrl).not.toHaveBeenCalled();
  hook.unmount();
  hook.client.clear();
});
it('aborts on scope unmount and refuses a late successful response', async () => {
  let resolve: ((result: { data: Blob }) => void) | undefined;
  api.GET.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const hook = setup(reportScope.branchId);
  let pending: Promise<unknown> | undefined;
  act(() => {
    pending = hook.result.current.mutateAsync().catch((error: unknown) => error);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const signal = api.GET.mock.calls[0]?.[1].signal as AbortSignal;
  hook.unmount();
  expect(signal.aborted).toBe(true);
  resolve?.({ data: new Blob(['synthetic']) });
  await pending;
  expect(createUrl).not.toHaveBeenCalled();
  expect(hook.client.getMutationCache().getAll()).toEqual([]);
  hook.client.clear();
});
