import { afterEach, beforeEach, expect, vi } from 'vitest';

export const state = {
  locale: 'en' as 'en' | 'ar',
  status: 'QUEUED' as string,
  errorCode: '' as string,
  shiftsError: undefined as { code: string; status: number } | undefined,
  employeesError: undefined as { code: string; status: number } | undefined,
  statusError: undefined as { code: string; status: number } | undefined,
};
export const api = { GET: vi.fn(), POST: vi.fn() };

import { attendanceStatementErrorsEn, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { boardBranches } from '../api/attendance-board.fixture';
import {
  statementRenderId,
  statementReport,
  statementScope,
  statementShifts,
} from '../api/attendance-statement.fixture';
import { AttendanceStatementPage } from './attendance-statement-page';

export const SUBMIT = 'attendanceStatementScreen.submit';
export const DOWNLOAD = 'attendanceStatementScreen.download';

function shiftsResponse() {
  if (state.shiftsError) {
    return {
      error: { code: state.shiftsError.code },
      response: { status: state.shiftsError.status },
    };
  }
  return { data: statementShifts };
}

export function statusResponse() {
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

function employeesResponse() {
  if (state.employeesError) {
    return {
      error: { code: state.employeesError.code },
      response: { status: state.employeesError.status },
    };
  }
  return { data: statementReport };
}

function defaultGet(path: string) {
  if (path.includes('attendance-statement-shifts')) return shiftsResponse();
  if (path.includes('attendance-report')) return employeesResponse();
  return statusResponse();
}

export function mockEmployeeReport(report: typeof statementReport, month?: string) {
  api.GET.mockImplementation((path: string) =>
    path.includes('attendance-report') ? { data: report } : defaultGet(path),
  );
  if (month) changeStatementMonth(month);
}

export function mockStatementShifts(shifts: typeof statementShifts) {
  api.GET.mockImplementation((path: string) =>
    path.includes('attendance-statement-shifts') ? { data: shifts } : defaultGet(path),
  );
}

beforeEach(() => {
  state.locale = 'en';
  state.status = 'QUEUED';
  state.errorCode = '';
  state.shiftsError = undefined;
  state.employeesError = undefined;
  state.statusError = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T22:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  api.GET.mockImplementation(defaultGet);
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

export function setup() {
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

export async function openStatement() {
  const view = setup();
  await screen.findByLabelText(t('en', 'attendanceStatementScreen.branch'));
  return view;
}

export async function requestStatement() {
  const view = await openStatement();
  fireEvent.click(submitButton());
  return view;
}

export async function requestStatementRefusal(code: string, status: number) {
  api.POST.mockResolvedValue({ error: { code }, response: { status } });
  const view = await requestStatement();
  await screen.findByText(
    attendanceStatementErrorsEn[code as keyof typeof attendanceStatementErrorsEn],
  );
  expect(screen.getByRole('button', { name: t('en', SUBMIT) })).toBeTruthy();
  view.close();
}

export async function requestReadyStatement() {
  state.status = 'READY';
  return requestStatement();
}

export async function employeeField() {
  const key = 'attendanceStatementScreen.employeeOptional';
  const field = (await screen.findByLabelText(t('en', key))) as HTMLSelectElement;
  await within(field).findByRole('option', { name: /Synthetic employee/ });
  return field;
}

export async function openStatementWithEmployee(employeeId: string) {
  const view = await openStatement();
  const employee = await employeeField();
  fireEvent.change(employee, { target: { value: employeeId } });
  return { view, employee };
}

export function unconfirmedEmployeeOption() {
  return screen.findByRole('option', {
    name: t('en', 'attendanceStatementScreen.employeeUnconfirmed'),
  });
}

export function clearStatementCustomPeriod() {
  fireEvent.click(screen.getByLabelText(t('en', 'attendanceStatementScreen.periodCustom')));
  for (const key of ['from', 'to'] as const) {
    fireEvent.change(screen.getByLabelText(t('en', `attendanceStatementScreen.${key}`)), {
      target: { value: '' },
    });
  }
}

export function changeStatementMonth(month: string) {
  fireEvent.change(screen.getByLabelText(t('en', 'attendanceStatementScreen.month')), {
    target: { value: month },
  });
}

export function mockCollectError(code: string, status = 500) {
  api.POST.mockImplementation((path: string) =>
    path.endsWith('/download')
      ? { error: { code }, response: { status } }
      : { data: { render_id: statementRenderId }, response: { status: 202 } },
  );
}

export async function requestFailedCollect(code: string, status = 500) {
  mockCollectError(code, status);
  const view = await requestReadyStatement();
  fireEvent.click(await screen.findByRole('button', { name: t('en', DOWNLOAD) }));
  return view;
}

export function submitButton() {
  return screen.getByRole('button', { name: t('en', SUBMIT) }) as HTMLButtonElement;
}

export function checkAgainButton() {
  return screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.checkAgain') });
}

export function newRequestButton() {
  return screen.getByRole('button', { name: t('en', 'attendanceStatementScreen.newRequest') });
}

export function expectRecoveryActions() {
  expect(checkAgainButton()).toBeTruthy();
  expect(newRequestButton()).toBeTruthy();
}

export function expectNewRequestOnly() {
  expect(newRequestButton()).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: t('en', 'attendanceStatementScreen.checkAgain') }),
  ).toBeNull();
}

export async function expectStatementNoAccess() {
  await screen.findByText(t('en', 'attendanceStatementScreen.noAccess'));
  expect(screen.queryByRole('button', { name: t('en', SUBMIT) })).toBeNull();
}

export function statusChecks() {
  return api.GET.mock.calls.filter(
    ([, init]) =>
      (init as { params?: { path?: { renderId?: string } } } | undefined)?.params?.path
        ?.renderId === statementRenderId,
  ).length;
}

export function reportRow(index: number) {
  const row = statementReport.rows[index];
  if (!row) throw new Error(`the statement report fixture has no row ${index}`);
  return row;
}
