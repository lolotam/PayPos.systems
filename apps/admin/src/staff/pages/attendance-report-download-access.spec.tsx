import { Blob as NodeBlob } from 'node:buffer';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { boardBranches } from '../api/attendance-board.fixture';
import { reportFixture, reportScope } from '../api/attendance-report.fixture';
import { AttendanceReportPage } from './attendance-report-page';
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
beforeEach(() => {
  api.GET.mockReset().mockResolvedValue({ data: reportFixture });
});
const errors = [
  { code: 'UNAUTHENTICATED', status: 401 },
  { code: 'FORBIDDEN', status: 403 },
  { code: 'NOT_FOUND', status: 404 },
  { code: 'FEATURE_DISABLED', status: 409 },
  { code: 'NOT_READY', status: 503 },
];
it.each(errors.flatMap((error) => [false, true].map((all) => ({ ...error, all }))))(
  'CSV $code ($all all branches) clears cached totals only for access loss',
  async ({ code, status, all }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <AttendanceReportPage
          scope={reportScope}
          branches={boardBranches}
          allowAllBranches
          timezone="Asia/Kuwait"
          onBranch={vi.fn()}
        />
      </QueryClientProvider>,
    );
    await screen.findByRole('table');
    if (all) {
      fireEvent.change(screen.getByLabelText(t('en', 'attendanceReport.branch')), {
        target: { value: 'all' },
      });
      await waitFor(() => expect(api.GET).toHaveBeenCalledTimes(2));
      await screen.findByRole('table');
    }
    const before = api.GET.mock.calls.length;
    const queryKey = [
      'attendance-report',
      reportScope.companyId,
      reportScope.businessId,
      reportScope.userId,
      all ? 'all' : reportScope.branchId,
    ];
    const month = client.getQueryCache().findAll({ queryKey })[0]?.queryKey.at(-1);
    client.setQueryData([...queryKey, '2026-01'], reportFixture);
    api.GET.mockImplementation(async (path) =>
      path.endsWith('.csv')
        ? { error: new NodeBlob([JSON.stringify({ code })]), response: { status } }
        : Promise.reject(new Error('Synthetic transient read outage')),
    );
    fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceReport.download') }));
    await screen.findByRole('alert');
    const lost = status !== 503;
    await waitFor(() => expect(Boolean(screen.queryByRole('table'))).toBe(!lost));
    expect(client.getQueryData([...queryKey, month])).toEqual(lost ? undefined : reportFixture);
    expect(client.getQueryData([...queryKey, '2026-01'])).toEqual(lost ? undefined : reportFixture);
    expect(screen.queryByText('160:05') !== null).toBe(!lost);
    expect(
      (
        screen.getByRole('button', {
          name: t('en', 'attendanceReport.download'),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(lost);
    expect(api.GET.mock.calls.length).toBe(before + (lost ? 2 : 1));
    view.unmount();
    client.clear();
  },
);
