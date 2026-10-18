import { localDate, t } from '@pospay/i18n';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardBranches, otherBoardId } from '../api/attendance-board.fixture';
import { reportFixture, reportScope } from '../api/attendance-report.fixture';
import { AttendanceReportPage } from './attendance-report-page';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset();
  api.GET.mockResolvedValue({ data: reportFixture });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:synthetic'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});
function setup(allowAllBranches = true, branches = boardBranches) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onBranch = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <AttendanceReportPage
        scope={reportScope}
        branches={branches}
        allowAllBranches={allowAllBranches}
        timezone="Asia/Kuwait"
        onBranch={onBranch}
      />
    </QueryClientProvider>,
  );
  return {
    client,
    onBranch,
    close: () => {
      view.unmount();
      client.clear();
    },
  };
}
it('defaults to October at 2026-09-30T22:00Z in Kuwait', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
  const view = setup();
  await screen.findByRole('table');
  expect((screen.getByLabelText(t('en', 'attendanceReport.month')) as HTMLInputElement).value).toBe(
    '2026-10',
  );
  expect(api.GET.mock.calls[0]?.[1].params.query.month).toBe('2026-10');
  view.close();
});
it('keeps monthly totals and shows a refresh notice when a focus refetch fails', async () => {
  const view = setup();
  await screen.findByRole('table');
  focusManager.setFocused(false);
  api.GET.mockRejectedValue(new Error('Synthetic outage'));
  act(() => focusManager.setFocused(true));
  await screen.findByText(t('en', 'attendanceReport.refreshError'));
  expect(api.GET).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByText('160:05')).toBeTruthy();
  expect(
    (
      screen.getByRole('button', {
        name: t('en', 'attendanceReport.download'),
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  view.close();
});
it.each([true, false])(
  'limits branch options to the workspace scope (all: %s)',
  async (allowAllBranches) => {
    state.locale = 'ar';
    const view = setup(allowAllBranches);
    await screen.findByRole('table');
    const picker = screen.getByLabelText(t('ar', 'attendanceReport.branch'));
    expect(
      within(picker).queryByRole('option', { name: t('ar', 'attendanceReport.allBranches') }) !==
        null,
    ).toBe(allowAllBranches);
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value),
    ).toEqual(
      allowAllBranches
        ? ['all', ...boardBranches.map((branch) => branch.id)]
        : boardBranches.map((branch) => branch.id),
    );
    view.close();
  },
);
it('renders the existing not-found message when the server refuses all branches', async () => {
  const view = setup();
  await screen.findByRole('table');
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceReport.branch')), {
    target: { value: 'all' },
  });
  await screen.findByText(t('en', 'attendanceReport.notFound'));
  expect(api.GET.mock.calls.at(-1)?.[0]).toBe('/v1/businesses/{businessId}/attendance-report');
  expect(screen.queryByRole('table')).toBeNull();
  view.close();
});
it.each(['ar', 'en'] as const)(
  'renders monthly totals, leave, signed hours and warning styling in %s',
  async (locale) => {
    state.locale = locale;
    const view = setup();
    const table = await screen.findByRole('table', { name: t(locale, 'attendanceReport.title') });
    const row = within(table).getByText('Synthetic employee').closest('tr');
    if (!row) throw new Error('Missing report row');
    expect(
      within(table).getByRole('columnheader', { name: t(locale, 'attendanceReport.employeeNumber') }),
    ).toBeTruthy();
    expect(within(row).getByText('15')).toBeTruthy();
    const unnumbered = within(table).getByText('Other synthetic employee').closest('tr');
    if (!unnumbered) throw new Error('Missing report row');
    expect(within(unnumbered).getByText('\u2014')).toBeTruthy();
    for (const value of ['20', '160:05', '168:00', '170:00', '-9:55', '27'])
      expect(within(row).getByText(value)).toBeTruthy();
    expect(within(row).getByText('-9:55').getAttribute('dir')).toBe('ltr');
    expect(within(row).getByText('-9:55').parentElement?.className).toContain('bg-pending');
    expect(within(table).getByText('+1:40').parentElement?.className).toContain('bg-secondary');
    for (const key of [
      'annualLeaveDays',
      'sickLeaveDays',
      'unpaidLeaveDays',
      'otherLeaveDays',
    ] as const)
      expect(within(row).getByText(t(locale, `attendanceReport.${key}`))).toBeTruthy();
    for (const value of ['1:30', '0:30', '0:45', '2:00'])
      expect(within(row).getByText(value)).toBeTruthy();
    expect(
      (screen.getByLabelText(t(locale, 'attendanceReport.month')) as HTMLInputElement).value,
    ).toBe(localDate(new Date(), 'Asia/Kuwait').slice(0, 7));
    view.close();
  },
);
it('sorts a loaded month numerically without making another request', async () => {
  const view = setup();
  const table = await screen.findByRole('table');
  fireEvent.click(
    within(table).getByRole('button', { name: t('en', 'attendanceReport.workedHours') }),
  );
  expect(within(table).getAllByRole('row')[1]?.textContent).toContain('Synthetic employee');
  fireEvent.click(
    within(table).getByRole('button', { name: t('en', 'attendanceReport.workedHours') }),
  );
  expect(within(table).getAllByRole('row')[1]?.textContent).toContain('Other synthetic employee');
  expect(api.GET).toHaveBeenCalledTimes(1);
  view.close();
});
it('changes month, uses the business route for all branches, then chooses a workspace branch', async () => {
  const view = setup();
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceReport.month')), {
    target: { value: '2026-09' },
  });
  await waitFor(() => expect(api.GET.mock.calls.at(-1)?.[1].params.query.month).toBe('2026-09'));
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceReport.branch')), {
    target: { value: 'all' },
  });
  await waitFor(() =>
    expect(api.GET.mock.calls.at(-1)?.[0]).toBe('/v1/businesses/{businessId}/attendance-report'),
  );
  expect(api.GET.mock.calls.at(-1)?.[1].params).toMatchObject({
    path: { businessId: reportScope.businessId },
    query: { month: '2026-09' },
  });
  expect(view.onBranch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceReport.branch')), {
    target: { value: otherBoardId },
  });
  expect(view.onBranch).toHaveBeenCalledWith(otherBoardId);
  expect((screen.getByLabelText(t('en', 'attendanceReport.month')) as HTMLInputElement).value).toBe(
    '2026-09',
  );
  view.close();
});
it('shows loading and empty states and permits an empty CSV export', async () => {
  api.GET.mockResolvedValue({ data: { ...reportFixture, rows: [] } });
  const view = setup();
  expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
  expect(
    (
      screen.getByRole('button', {
        name: t('en', 'attendanceReport.download'),
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await screen.findByText(t('en', 'attendanceReport.empty'));
  expect(screen.queryByRole('table')).toBeNull();
  expect(
    (
      screen.getByRole('button', {
        name: t('en', 'attendanceReport.download'),
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  view.close();
});
it.each(['NOT_FOUND', 'FEATURE_DISABLED', 'NOT_READY'] as const)(
  'shows report error %s and retries',
  async (code) => {
    api.GET.mockResolvedValue({
      error: { code },
      response: { status: code === 'NOT_FOUND' ? 404 : 403 },
    });
    const view = setup();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      t(
        'en',
        code === 'NOT_FOUND'
          ? 'attendanceReport.notFound'
          : code === 'FEATURE_DISABLED'
            ? 'attendanceReport.featureDisabled'
            : 'admin.unexpected',
      ),
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      (
        screen.getByRole('button', {
          name: t('en', 'attendanceReport.download'),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    api.GET.mockResolvedValue({ data: reportFixture });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceReport.retry') }));
    await screen.findByRole('table');
    view.close();
  },
);
it.each([
  { code: 'NOT_FOUND', status: 404 },
  { code: 'FORBIDDEN', status: 403 },
  { code: 'FEATURE_DISABLED', status: 409 },
])('hides loaded totals when access is revoked during a refresh (%s)', async ({ code, status }) => {
  const view = setup();
  await screen.findByRole('table');
  api.GET.mockResolvedValue({ error: { code }, response: { status } });
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ['attendance-report'] });
  });
  await screen.findByText(
    t(
      'en',
      code === 'NOT_FOUND'
        ? 'attendanceReport.notFound'
        : code === 'FEATURE_DISABLED'
          ? 'attendanceReport.featureDisabled'
          : 'admin.unexpected',
    ),
  );
  expect(screen.queryByRole('table')).toBeNull();
  view.close();
});
it('downloads the selected all-branches month, shows busy state and displays CSV errors', async () => {
  const view = setup();
  await screen.findByRole('table');
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceReport.month')), {
    target: { value: '2026-09' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceReport.branch')), {
    target: { value: 'all' },
  });
  await screen.findByRole('table');
  let finish:
    ((result: { error: { code: string }; response: { status: number } }) => void) | undefined;
  api.GET.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceReport.download') }));
  const busy = await screen.findByRole('button', { name: t('en', 'attendanceReport.downloading') });
  expect(busy.getAttribute('aria-busy')).toBe('true');
  expect((busy as HTMLButtonElement).disabled).toBe(true);
  expect(api.GET.mock.calls.at(-1)?.[0]).toBe('/v1/businesses/{businessId}/attendance-report.csv');
  expect(api.GET.mock.calls.at(-1)?.[1].params.query).toEqual({ month: '2026-09' });
  await act(async () => {
    finish?.({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  });
  await screen.findByText(t('en', 'attendanceReport.notFound'));
  view.close();
});
it.each(['ar', 'en'] as const)(
  'passes the displayed branch name to the CSV download in %s',
  async (locale) => {
    state.locale = locale;
    const branches = boardBranches.map((branch) => ({
      ...branch,
      name_ar: t('ar', 'attendanceReport.branch'),
    }));
    const view = setup(true, branches);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText(t(locale, 'attendanceReport.month')), {
      target: { value: '2026-09' },
    });
    await screen.findByRole('table');
    api.GET.mockResolvedValue({ data: new Blob(['synthetic']) });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'attendanceReport.download') }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances.at(-1) as
      HTMLAnchorElement | undefined;
    const name = locale === 'ar' ? t('ar', 'attendanceReport.branch') : 'Synthetic-branch';
    expect(anchor?.download).toBe(`attendance-${name}-2026-09.csv`);
    view.close();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
  },
);
