import { t, formatInstant, localDate } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  boardBranches,
  boardFixture,
  boardId,
  boardScope,
  otherBoardId,
  refusalFixture,
} from '../api/attendance-board.fixture';
import { AttendanceBoardPage } from './attendance-board-page';
const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
const api = vi.hoisted(() => ({ GET: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

vi.mock('@/staff/api/use-attendance-capabilities', () => ({
  useAttendanceCapabilities: () => ({
    isPending: false,
    capabilities: { correct: true, resolve: true, request_change: true, decide: true },
  }),
}));
beforeEach(() => {
  state.locale = 'en';
  api.GET.mockReset();
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith('refusals') ? refusalFixture : boardFixture,
  }));
});
afterEach(() => vi.useRealTimers());
function setup(date?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onDate = vi.fn();
  const onBranch = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <AttendanceBoardPage
        scope={boardScope}
        branches={boardBranches}
        date={date}
        onDate={onDate}
        onBranch={onBranch}
      />
    </QueryClientProvider>,
  );
  return {
    client,
    onDate,
    onBranch,
    close: () => {
      view.unmount();
      client.clear();
    },
  };
}
it.each(['ar', 'en'] as const)(
  'renders all sections, local times and badges in %s',
  async (locale) => {
    state.locale = locale;
    const view = setup();
    const inNow = await screen.findByRole('region', { name: t(locale, 'attendanceBoard.inNow') });
    expect(within(inNow).getByText('2:45')).toBeTruthy();
    expect(
      within(inNow).getByText(
        formatInstant(
          new Date(boardFixture.in_now[0]?.clock_in ?? ''),
          locale,
          boardFixture.timezone,
        ),
      ),
    ).toBeTruthy();
    const daily = screen.getByRole('region', { name: t(locale, 'attendanceBoard.sessions') });
    for (const key of [
      'MISSED_OUT',
      'corrected',
      'NONE',
      'OUT_OF_RANGE',
      'SUSPECTED_MISSED_OUT',
      'MANUAL',
    ] as const)
      expect(within(daily).getByText(t(locale, `attendanceBoard.${key}`))).toBeTruthy();
    expect(within(daily).getByTitle(t(locale, 'attendanceBoard.manualDetail'))).toBeTruthy();
    expect(within(daily).getByText('12')).toBeTruthy();
    expect(
      within(daily).getByRole('columnheader', { name: t(locale, 'attendanceBoard.employeeNumber') }),
    ).toBeTruthy();
    expect(within(daily).getByText('\u2014')).toBeTruthy();
    expect(within(inNow).getByText('\u2014')).toBeTruthy();
    expect(
      (screen.getByLabelText(t(locale, 'attendanceBoard.date')) as HTMLInputElement).value,
    ).toBe('2026-10-11');
    const attempts = screen.getByRole('region', { name: t(locale, 'attendanceBoard.refusals') });
    await within(attempts).findByText(t(locale, 'attendanceBoard.DEVICE_LOCKED'));
    expect(within(attempts).getByText('Synthetic employee')).toBeTruthy();
    expect(within(attempts).getByText('Synthetic manual employee')).toBeTruthy();
    view.close();
  },
);
it.each(['ar', 'en'] as const)(
  'renders overnight cells on different Kuwait days in %s',
  async (locale) => {
    state.locale = locale;
    const clockIn = new Date('2026-10-10T20:30:00Z');
    const clockOut = new Date('2026-10-10T22:00:00Z');
    const session = {
      ...boardFixture.sessions[0],
      clock_in: clockIn.toISOString(),
      clock_out: clockOut.toISOString(),
    };
    api.GET.mockImplementation(async (path: string) => ({
      data: path.endsWith('refusals')
        ? refusalFixture
        : { ...boardFixture, date: '2026-10-10', sessions: [session] },
    }));
    const view = setup('2026-10-10');
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1];
    if (!row) throw new Error('Missing overnight row');
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]?.textContent).toBe('\u2014');
    expect(cells[2]?.textContent).toBe(formatInstant(clockIn, locale, 'Asia/Kuwait'));
    expect(cells[3]?.textContent).toBe(formatInstant(clockOut, locale, 'Asia/Kuwait'));
    expect(localDate(clockIn, 'Asia/Kuwait')).toBe('2026-10-10');
    expect(localDate(clockOut, 'Asia/Kuwait')).toBe('2026-10-11');
    expect(
      (screen.getByLabelText(t(locale, 'attendanceBoard.date')) as HTMLInputElement).value,
    ).toBe('2026-10-10');
    view.close();
  },
);
it('keeps the date picker usable after a first-load failure with branch-local today', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
  api.GET.mockRejectedValue(new Error('Synthetic outage'));
  const view = setup();
  await screen.findByRole('alert');
  const date = screen.getByLabelText(t('en', 'attendanceBoard.date')) as HTMLInputElement;
  expect(date.disabled).toBe(false);
  expect(date.max).toBe('2026-10-01');
  fireEvent.change(date, { target: { value: '2026-09-30' } });
  expect(view.onDate).toHaveBeenCalledWith('2026-09-30');
  fireEvent.change(date, { target: { value: '2026-10-02' } });
  expect(view.onDate).toHaveBeenCalledTimes(1);
  view.close();
});
it('loads more refusals by cursor, preserves newest first and removes duplicates', async () => {
  api.GET.mockImplementation(
    async (path: string, options: { params: { query: { cursor?: string } } }) => ({
      data: !path.endsWith('refusals')
        ? boardFixture
        : options.params.query.cursor
          ? {
              items: [
                refusalFixture.items[0],
                {
                  ...refusalFixture.items[0],
                  id: otherBoardId,
                  step: 'ENROL',
                  reason: 'NOT_ENROLLED',
                  holder_employee_id: null,
                  holder: null,
                  employee_id: '01920000-0000-7000-8000-0000000000a5',
                  employee: {
                    id: '01920000-0000-7000-8000-0000000000a5',
                    name_ar: null,
                    name_en: 'Synthetic absent employee',
                  },
                  attempted_at: '2026-10-10T21:00:00Z',
                },
              ],
              next_cursor: null,
            }
          : refusalFixture,
    }),
  );
  const view = setup();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'attendanceBoard.loadMore') }));
  await screen.findByText(t('en', 'attendanceBoard.NOT_ENROLLED'));
  const list = within(
    screen.getByRole('region', { name: t('en', 'attendanceBoard.refusals') }),
  ).getAllByRole('listitem');
  expect(list).toHaveLength(2);
  expect(list[0]?.textContent).toContain(t('en', 'attendanceBoard.DEVICE_LOCKED'));
  expect(list[1]?.textContent).toContain('Synthetic absent employee');
  expect(list[1]?.textContent).toContain(t('en', 'attendanceBoard.unavailable'));
  expect(list[1]?.textContent).not.toContain('01920000-0000-7000-8000-0000000000a5');
  expect(screen.queryByRole('button', { name: t('en', 'attendanceBoard.loadMore') })).toBeNull();
  view.close();
});
it.each(['OPEN', 'CLOSED'] as const)('renders the %s badge and card source', async (status) => {
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith('refusals')
      ? { items: [], next_cursor: null }
      : {
          ...boardFixture,
          sessions: boardFixture.sessions.map((row) => ({
            ...row,
            status,
            source: 'BARCODE',
            corrected: false,
            open_exceptions: [],
            manual: null,
            clock_out: status === 'OPEN' ? null : row.clock_out,
          })),
        },
  }));
  const view = setup();
  const daily = await screen.findByRole('region', { name: t('en', 'attendanceBoard.sessions') });
  expect(within(daily).getByText(t('en', `attendanceBoard.${status}`))).toBeTruthy();
  expect(within(daily).getByText(t('en', 'attendanceBoard.BARCODE'))).toBeTruthy();
  expect(within(daily).queryByText(t('en', 'attendanceBoard.corrected'))).toBeNull();
  view.close();
});
it('allows past dates, rejects future dates and selects branches from the business', async () => {
  const view = setup();
  await screen.findByRole('table');
  const date = screen.getByLabelText(t('en', 'attendanceBoard.date')) as HTMLInputElement;
  expect(date.max).toBe('2026-10-11');
  fireEvent.change(date, { target: { value: '2026-10-12' } });
  expect(view.onDate).not.toHaveBeenCalled();
  fireEvent.change(date, { target: { value: '2026-10-09' } });
  expect(view.onDate).toHaveBeenCalledWith('2026-10-09');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceBoard.today') }));
  expect(view.onDate).toHaveBeenLastCalledWith(undefined);
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceBoard.branch')), {
    target: { value: otherBoardId },
  });
  expect(view.onBranch).toHaveBeenCalledWith(otherBoardId);
  view.close();
});
it('renders loading and every empty section', async () => {
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith('refusals')
      ? { items: [], next_cursor: null }
      : { ...boardFixture, in_now: [], sessions: [] },
  }));
  const view = setup();
  expect(screen.getByRole('status').textContent).toBe(t('en', 'admin.loading'));
  for (const key of ['emptyInNow', 'emptySessions', 'emptyRefusals'] as const)
    await screen.findByText(t('en', `attendanceBoard.${key}`));
  view.close();
});
it.each(['NOT_FOUND', 'FEATURE_DISABLED', 'NOT_READY'] as const)(
  'renders board error %s',
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
          ? 'attendanceBoard.notFound'
          : code === 'FEATURE_DISABLED'
            ? 'attendanceBoard.featureDisabled'
            : 'admin.unexpected',
      ),
    );
    expect(screen.queryByRole('table')).toBeNull();
    view.close();
  },
);
it('keeps data and the last updated note when refreshing fails', async () => {
  const view = setup();
  await screen.findByRole('table');
  api.GET.mockRejectedValue(new Error('Synthetic outage'));
  await view.client.invalidateQueries({
    queryKey: ['attendance-board', boardId, boardId, boardId, boardId, 'day'],
  });
  await screen.findByText(t('en', 'attendanceBoard.refreshError'));
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByText(/Last updated/)).toBeTruthy();
  view.close();
});
it('hides cached attendance when the server revokes access', async () => {
  const view = setup();
  await screen.findByRole('table');
  api.GET.mockResolvedValue({ error: { code: 'NOT_FOUND' }, response: { status: 404 } });
  await view.client.invalidateQueries({
    queryKey: ['attendance-board', boardId, boardId, boardId, boardId, 'day'],
  });
  await screen.findByText(t('en', 'attendanceBoard.notFound'));
  expect(screen.queryByRole('table')).toBeNull();
  view.close();
});
it('handles a refusal endpoint error independently and retries', async () => {
  api.GET.mockImplementation(async (path: string) =>
    path.endsWith('refusals')
      ? { error: { code: 'FEATURE_DISABLED' }, response: { status: 403 } }
      : { data: boardFixture },
  );
  const view = setup();
  await screen.findByText(t('en', 'attendanceBoard.featureDisabled'));
  expect(screen.getByRole('table')).toBeTruthy();
  api.GET.mockImplementation(async (path: string) => ({
    data: path.endsWith('refusals') ? { ...refusalFixture, next_cursor: null } : boardFixture,
  }));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'attendanceBoard.retry') }));
  await screen.findByText(t('en', 'attendanceBoard.DEVICE_LOCKED'));
  view.close();
});
