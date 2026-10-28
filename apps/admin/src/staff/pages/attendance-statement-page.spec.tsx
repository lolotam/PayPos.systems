import { attendanceStatementErrorsEn, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { boardBranches, boardId } from '../api/attendance-board.fixture';
import {
  statementRenderId,
  statementReport,
  statementScope,
  statementShifts,
} from '../api/attendance-statement.fixture';
import { STATEMENT_POLL_DEADLINE_MS } from '../api/use-attendance-statement-status';
import { AttendanceStatementPage } from './attendance-statement-page';

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  status: 'QUEUED' as string,
  errorCode: '' as string,
  shiftsError: undefined as { code: string; status: number } | undefined,
  statusError: undefined as { code: string; status: number } | undefined,
}));
const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const SUBMIT = 'attendanceStatementScreen.submit';
const DOWNLOAD = 'attendanceStatementScreen.download';

function shiftsResponse() {
  if (state.shiftsError) {
    return {
      error: { code: state.shiftsError.code },
      response: { status: state.shiftsError.status },
    };
  }
  return { data: statementShifts };
}

function statusResponse() {
  if (state.statusError) {
    return {
      error: { code: state.statusError.code },
      response: { status: state.statusError.status },
    };
  }
  const data = state.errorCode
    ? { state: state.status, error_code: state.errorCode }
    : { state: state.status };
  return { data };
}

beforeEach(() => {
  state.locale = 'en';
  state.status = 'QUEUED';
  state.errorCode = '';
  state.shiftsError = undefined;
  state.statusError = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  api.GET.mockImplementation((path: string) => {
    if (path.includes('attendance-statement-shifts')) return shiftsResponse();
    if (path.includes('attendance-report')) return { data: statementReport };
    return statusResponse();
  });
  api.POST.mockImplementation((path: string) =>
    path.endsWith('/download')
      ? { data: new Blob(['synthetic pdf']), response: { status: 200 } }
      : { data: { render_id: statementRenderId }, response: { status: 202 } },
  );
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
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onBranch = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <AttendanceStatementPage
        scope={statementScope}
        branches={boardBranches}
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

function submitButton() {
  return screen.getByRole('button', { name: t('en', SUBMIT) }) as HTMLButtonElement;
}

it.each(['ar', 'en'] as const)('renders every field of the screen in %s', async (locale) => {
  state.locale = locale;
  const view = setup();
  await screen.findByLabelText(t(locale, 'attendanceStatementScreen.branch'));
  expect(screen.getByLabelText(t(locale, 'attendanceStatementScreen.formBranch'))).toBeTruthy();
  expect(screen.getByLabelText(t(locale, 'attendanceStatementScreen.formEmployee'))).toBeTruthy();
  expect(screen.getByLabelText(t(locale, 'attendanceStatementScreen.periodMonth'))).toBeTruthy();
  expect(screen.getByLabelText(t(locale, 'attendanceStatementScreen.periodCustom'))).toBeTruthy();
  expect(screen.getByLabelText(t(locale, 'attendanceStatementScreen.month'))).toBeTruthy();
  expect(
    screen.getByLabelText(t(locale, 'attendanceStatementScreen.employeeOptional')),
  ).toBeTruthy();
  expect(screen.getByLabelText(t(locale, 'attendanceStatementScreen.languageArabic'))).toBeTruthy();
  expect(
    screen.getByLabelText(t(locale, 'attendanceStatementScreen.languageEnglish')),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: t(locale, SUBMIT) })).toBeTruthy();
  view.close();
});

it('hides the shift filter and blocks the request until an employee is chosen', async () => {
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.shift'));
  fireEvent.click(screen.getByLabelText(t('en', 'attendanceStatementScreen.formEmployee')));
  expect(screen.queryByLabelText(t('en', 'attendanceStatementScreen.shift'))).toBeNull();
  const employee = await screen.findByLabelText(
    t('en', 'attendanceStatementScreen.employeeRequired'),
  );
  await waitFor(() => expect(within(employee).getAllByRole('option')).toHaveLength(3));
  expect(submitButton().disabled).toBe(true);
  fireEvent.change(employee, { target: { value: boardId } });
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  view.close();
});

it('lists the shift pairs of the period and clears the chosen pair when the period changes', async () => {
  const view = setup();
  const shift = await screen.findByLabelText(t('en', 'attendanceStatementScreen.shift'));
  expect(
    within(shift)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual([t('en', 'attendanceStatementScreen.shiftAll'), '09:00 — 20:00', '08:00 — 16:00']);
  fireEvent.change(shift, { target: { value: '09:00|20:00' } });
  await waitFor(() => expect((shift as HTMLSelectElement).value).toBe('09:00|20:00'));
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceStatementScreen.month')), {
    target: { value: '2026-09' },
  });
  await waitFor(() => {
    const next = screen.getByLabelText(
      t('en', 'attendanceStatementScreen.shift'),
    ) as HTMLSelectElement;
    expect(next.value).toBe('');
  });
  view.close();
});

it('shows the waiting state and locks the form once the request is accepted', async () => {
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  await screen.findByText(t('en', 'attendanceStatementScreen.waiting'));
  expect(submitButton().disabled).toBe(true);
  view.close();
});

it('locks the fields and ignores a second click while the request is pending', async () => {
  let accept: (() => void) | undefined;
  api.POST.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = () =>
          resolve({ data: { render_id: statementRenderId }, response: { status: 202 } });
      }),
  );
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  const pending = (await screen.findByRole('button', {
    name: t('en', 'attendanceStatementScreen.submitting'),
  })) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  expect(
    screen.getByLabelText(t('en', 'attendanceStatementScreen.month')).matches(':disabled'),
  ).toBe(true);
  fireEvent.click(pending);
  expect(api.POST).toHaveBeenCalledTimes(1);
  await act(async () => accept?.());
  await screen.findByText(t('en', 'attendanceStatementScreen.waiting'));
  view.close();
});

it('enables the download only when the statement is ready', async () => {
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  await screen.findByText(t('en', 'attendanceStatementScreen.waiting'));
  expect(screen.queryByRole('button', { name: t('en', DOWNLOAD) })).toBeNull();
  state.status = 'READY';
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ['attendance-statement-status'] });
  });
  const download = await screen.findByRole('button', { name: t('en', DOWNLOAD) });
  expect((download as HTMLButtonElement).disabled).toBe(false);
  view.close();
});

it('collects the statement once and then asks for a new one', async () => {
  state.status = 'READY';
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  const download = await screen.findByRole('button', { name: t('en', DOWNLOAD) });
  fireEvent.click(download);
  await screen.findByText(t('en', 'attendanceStatementScreen.downloaded'));
  expect(
    (screen.getByRole('button', { name: t('en', DOWNLOAD) }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') }),
  ).toBeTruthy();
  const anchor = vi.mocked(HTMLAnchorElement.prototype.click).mock.instances.at(-1) as
    HTMLAnchorElement | undefined;
  expect(anchor?.download).toBe('attendance-statement-branch-2026-10-01_2026-10-31.pdf');
  view.close();
});

it.each([
  { code: 'ATTENDANCE_STATEMENT_PERIOD_INVALID', status: 422 },
  { code: 'ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND', status: 404 },
  { code: 'ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND', status: 404 },
  { code: 'ATTENDANCE_STATEMENT_RATE_LIMITED', status: 429 },
  { code: 'ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID', status: 422 },
  { code: 'RENDERER_UNAVAILABLE', status: 503 },
])('shows the request refusal $code', async ({ code, status }) => {
  api.POST.mockResolvedValue({ error: { code }, response: { status } });
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  await screen.findByText(
    attendanceStatementErrorsEn[code as keyof typeof attendanceStatementErrorsEn],
  );
  expect(screen.getByRole('button', { name: t('en', SUBMIT) })).toBeTruthy();
  view.close();
});

function statusChecks() {
  return api.GET.mock.calls.filter(
    ([, init]) =>
      (init as { params?: { path?: { renderId?: string } } } | undefined)?.params?.path
        ?.renderId === statementRenderId,
  ).length;
}

it('recovers from a not-ready collect by checking the same render again', async () => {
  state.status = 'READY';
  api.POST.mockImplementation((path: string) =>
    path.endsWith('/download')
      ? { error: { code: 'DOCUMENT_NOT_READY' }, response: { status: 409 } }
      : { data: { render_id: statementRenderId }, response: { status: 202 } },
  );
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  fireEvent.click(await screen.findByRole('button', { name: t('en', DOWNLOAD) }));
  await screen.findByText(attendanceStatementErrorsEn.DOCUMENT_NOT_READY);
  const checksBefore = statusChecks();
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.checkAgain') }),
  );
  const download = await screen.findByRole('button', { name: t('en', DOWNLOAD) });
  expect((download as HTMLButtonElement).disabled).toBe(false);
  expect(statusChecks()).toBeGreaterThan(checksBefore);
  expect(api.POST).toHaveBeenCalledTimes(2);
  view.close();
});

it('shows the expired collect refusal', async () => {
  state.status = 'READY';
  api.POST.mockImplementation((path: string) =>
    path.endsWith('/download')
      ? { error: { code: 'DOCUMENT_EXPIRED' }, response: { status: 410 } }
      : { data: { render_id: statementRenderId }, response: { status: 202 } },
  );
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  fireEvent.click(await screen.findByRole('button', { name: t('en', DOWNLOAD) }));
  await screen.findByText(attendanceStatementErrorsEn.DOCUMENT_EXPIRED);
  expect(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') }),
  ).toBeTruthy();
  view.close();
});

it('shows the empty statement failure and resets the locked form', async () => {
  state.status = 'FAILED';
  state.errorCode = 'STATEMENT_EMPTY';
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  await screen.findByText('There is no attendance data in this period.');
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') }),
  );
  expect(submitButton().disabled).toBe(false);
  view.close();
});

it('treats a consumed statement as terminal and offers a new request', async () => {
  state.status = 'CONSUMED';
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  await screen.findByText(t('en', 'attendanceStatementScreen.consumed'));
  expect(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') }),
  ).toBeTruthy();
  view.close();
});

it('stops the poll after a minute and checks again only on demand', async () => {
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  // المؤقتات بتتعمل بعد الطلب عشان مهلة الدقيقة تبدأ من ساعة القبول.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
  fireEvent.click(submitButton());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText(t('en', 'attendanceStatementScreen.waiting'))).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(STATEMENT_POLL_DEADLINE_MS);
  });
  expect(screen.getByText(t('en', 'attendanceStatementScreen.timeout'))).toBeTruthy();
  const calls = api.GET.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(api.GET.mock.calls).toHaveLength(calls);
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.checkAgain') }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(api.GET.mock.calls.length).toBeGreaterThan(calls);
  view.close();
});

it('hides the form when the access probe is refused', async () => {
  state.shiftsError = { code: 'FORBIDDEN', status: 403 };
  const view = setup();
  await screen.findByText(t('en', 'attendanceStatementScreen.noAccess'));
  expect(screen.queryByRole('button', { name: t('en', SUBMIT) })).toBeNull();
  view.close();
});

it('hides the form when the create request loses access', async () => {
  api.POST.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  fireEvent.click(submitButton());
  await screen.findByText(t('en', 'attendanceStatementScreen.noAccess'));
  expect(screen.queryByRole('button', { name: t('en', SUBMIT) })).toBeNull();
  view.close();
});

it('stops polling and resets after an unknown render on the status poll', async () => {
  state.statusError = { code: 'NOT_FOUND', status: 404 };
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  vi.useFakeTimers();
  fireEvent.click(submitButton());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.getByText(t('en', 'attendanceStatementScreen.expired'))).toBeTruthy();
  const statusCalls = api.GET.mock.calls.filter(([path]) =>
    path.includes('/attendance-statements/'),
  ).length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(
    api.GET.mock.calls.filter(([path]) => path.includes('/attendance-statements/')),
  ).toHaveLength(statusCalls);
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') }),
  );
  expect(submitButton().disabled).toBe(false);
  view.close();
});
