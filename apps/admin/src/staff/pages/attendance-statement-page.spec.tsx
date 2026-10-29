import { attendanceStatementErrorsEn, t } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { boardId } from '../api/attendance-board.fixture';
import { statementRenderId, statementReport } from '../api/attendance-statement.fixture';
import { STATEMENT_POLL_DEADLINE_MS } from '../api/use-attendance-statement-status';
import {
  api,
  changeStatementMonth,
  checkAgainButton,
  clearStatementCustomPeriod,
  DOWNLOAD,
  expectNewRequestOnly,
  expectRecoveryActions,
  expectStatementNoAccess,
  mockEmployeeReport,
  newRequestButton,
  openStatement,
  openStatementWithEmployee,
  reportRow,
  requestFailedCollect,
  requestReadyStatement,
  requestStatement,
  requestStatementRefusal,
  setup,
  state,
  statusChecks,
  statusResponse,
  SUBMIT,
  submitButton,
  unconfirmedEmployeeOption,
} from './attendance-statement-page.fixture';

vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

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

it('clears an employee who has no coverage in the new period', async () => {
  const { view, employee } = await openStatementWithEmployee(boardId);
  mockEmployeeReport({ ...statementReport, rows: statementReport.rows.slice(1) }, '2026-09');
  expect(submitButton().disabled).toBe(true);
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  expect(employee.value).toBe('');
  api.POST.mockResolvedValue({ error: { code: 'UPSTREAM_FAILED' }, response: { status: 500 } });
  fireEvent.click(submitButton());
  await screen.findByText(t('en', 'admin.unexpected'));
  expect(api.POST.mock.calls[0]?.[1]?.body).not.toHaveProperty('employee_id');
  fireEvent.click(screen.getByLabelText(t('en', 'attendanceStatementScreen.formEmployee')));
  expect(submitButton().disabled).toBe(true);
  fireEvent.change(employee, { target: { value: reportRow(1).employee_id } });
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  view.close();
});

it('keeps an employee who still has coverage in the new period', async () => {
  const { view, employee } = await openStatementWithEmployee(boardId);
  mockEmployeeReport({
    ...statementReport,
    rows: [{ ...reportRow(0), name_en: 'September employee' }, reportRow(1)],
  });
  changeStatementMonth('2026-09');
  await screen.findByRole('option', { name: /September employee/ });
  expect(employee.value).toBe(boardId);
  view.close();
});

it('offers a retry when the employee list fails instead of showing it as empty', async () => {
  state.employeesError = { code: 'UPSTREAM_FAILED', status: 500 };
  const view = setup();
  await screen.findByText(t('en', 'attendanceStatementScreen.employeesFailed'));
  expect(screen.queryByText(t('en', 'attendanceStatementScreen.noEmployees'))).toBeNull();
  state.employeesError = undefined;
  fireEvent.click(checkAgainButton());
  expect(await screen.findByRole('option', { name: /Synthetic employee/ })).toBeTruthy();
  view.close();
});

it('shows an unconfirmed selected employee after a failure and allows clearing her', async () => {
  const { view, employee } = await openStatementWithEmployee(boardId);
  state.employeesError = { code: 'UPSTREAM_FAILED', status: 500 };
  changeStatementMonth('2026-09');
  await screen.findByText(t('en', 'attendanceStatementScreen.employeesFailed'));
  await unconfirmedEmployeeOption();
  expect(submitButton().disabled).toBe(true);
  fireEvent.change(employee, { target: { value: '' } });
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  view.close();
});

it('rejects a custom period with both dates cleared', async () => {
  const view = await openStatement();
  clearStatementCustomPeriod();
  await screen.findByText(t('en', 'attendanceStatementScreen.periodInvalid'));
  expect(submitButton().disabled).toBe(true);
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
  const view = await requestStatement();
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
  const view = await requestStatement();
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
  const view = await requestStatement();
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
  const view = await requestReadyStatement();
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

it('recovers a failed collect by checking the same statement again', async () => {
  const view = await requestFailedCollect('UPSTREAM_FAILED');
  await screen.findByText(t('en', 'admin.unexpected'));
  expectRecoveryActions();
  state.status = 'CONSUMED';
  fireEvent.click(checkAgainButton());
  await screen.findByText(t('en', 'attendanceStatementScreen.consumed'));
  expect(newRequestButton()).toBeTruthy();
  expect(api.POST).toHaveBeenCalledTimes(2);
  view.close();
});

it('recovers when a manual status re-check fails after stale ready data', async () => {
  const view = await requestFailedCollect('DOCUMENT_NOT_READY', 409);
  await screen.findByText(attendanceStatementErrorsEn.DOCUMENT_NOT_READY);
  state.statusError = { code: 'UPSTREAM_FAILED', status: 500 };
  fireEvent.click(checkAgainButton());
  await screen.findByText(t('en', 'admin.unexpected'));
  expectRecoveryActions();
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
  await requestStatementRefusal(code, status);
});

it.each([
  { freshStatus: 'READY', canDownload: true },
  { freshStatus: 'QUEUED', canDownload: false },
])(
  'hides the stale download during a re-check that resolves $freshStatus',
  async ({ freshStatus, canDownload }) => {
    const view = await requestFailedCollect('DOCUMENT_NOT_READY', 409);
    await screen.findByText(attendanceStatementErrorsEn.DOCUMENT_NOT_READY);
    const checksBefore = statusChecks();
    let resolveStatus: ((result: ReturnType<typeof statusResponse>) => void) | undefined;
    api.GET.mockImplementation((path: string) => {
      if (path.includes('/attendance-statements/')) {
        return new Promise<ReturnType<typeof statusResponse>>((resolve) => {
          resolveStatus = resolve;
        });
      }
      return statusResponse();
    });
    fireEvent.click(checkAgainButton());
    await screen.findByText(t('en', 'attendanceStatementScreen.waiting'));
    expect(screen.queryByRole('button', { name: t('en', DOWNLOAD) })).toBeNull();
    expect(statusChecks()).toBeGreaterThan(checksBefore);
    await act(async () => {
      state.status = freshStatus;
      resolveStatus?.(statusResponse());
      await Promise.resolve();
    });
    if (canDownload) {
      const download = await screen.findByRole('button', { name: t('en', DOWNLOAD) });
      expect((download as HTMLButtonElement).disabled).toBe(false);
    } else {
      await screen.findByText(t('en', 'attendanceStatementScreen.waiting'));
      expect(screen.queryByRole('button', { name: t('en', DOWNLOAD) })).toBeNull();
    }
    expect(api.POST).toHaveBeenCalledTimes(2);
    view.close();
  },
);

it.each([
  {
    code: 'DOCUMENT_EXPIRED',
    status: 410,
    message: attendanceStatementErrorsEn.DOCUMENT_EXPIRED,
  },
  {
    code: 'NOT_FOUND',
    status: 404,
    message: t('en', 'attendanceStatementScreen.expired'),
  },
])(
  'shows the terminal collect refusal $code without check-again',
  async ({ code, status, message }) => {
    const view = await requestFailedCollect(code, status);
    await screen.findByText(message);
    expectNewRequestOnly();
    view.close();
  },
);

it('shows the empty statement failure and resets the locked form', async () => {
  state.status = 'FAILED';
  state.errorCode = 'STATEMENT_EMPTY';
  const view = await requestStatement();
  await screen.findByText('There is no attendance data in this period.');
  fireEvent.click(newRequestButton());
  expect(submitButton().disabled).toBe(false);
  view.close();
});

it('treats a consumed statement as terminal and offers a new request', async () => {
  state.status = 'CONSUMED';
  const view = await requestStatement();
  await screen.findByText(t('en', 'attendanceStatementScreen.consumed'));
  expect(newRequestButton()).toBeTruthy();
  view.close();
});

it('stops the poll after a minute and checks again only on demand', async () => {
  const view = await openStatement();
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
  await expectStatementNoAccess();
  view.close();
});

it('hides the form when the create request loses access', async () => {
  api.POST.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  const view = await requestStatement();
  await expectStatementNoAccess();
  view.close();
});

it('keeps an unknown render terminal after the polling deadline', async () => {
  state.statusError = { code: 'NOT_FOUND', status: 404 };
  const view = await openStatement();
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
    await vi.advanceTimersByTimeAsync(STATEMENT_POLL_DEADLINE_MS);
  });
  expect(
    api.GET.mock.calls.filter(([path]) => path.includes('/attendance-statements/')),
  ).toHaveLength(statusCalls);
  expect(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: t('en', 'attendanceStatementScreen.checkAgain') }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') }),
  );
  expect(submitButton().disabled).toBe(false);
  view.close();
});
