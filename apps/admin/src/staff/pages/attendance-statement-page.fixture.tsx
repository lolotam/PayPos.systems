import { afterEach, beforeEach, vi } from 'vitest';

export const state = {
  locale: 'en' as 'en' | 'ar',
  status: 'QUEUED' as string,
  errorCode: '' as string,
  shiftsError: undefined as { code: string; status: number } | undefined,
  statusError: undefined as { code: string; status: number } | undefined,
};
export const api = { GET: vi.fn(), POST: vi.fn() };

import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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

export function submitButton() {
  return screen.getByRole('button', { name: t('en', SUBMIT) }) as HTMLButtonElement;
}

export function statusChecks() {
  return api.GET.mock.calls.filter(
    ([, init]) =>
      (init as { params?: { path?: { renderId?: string } } } | undefined)?.params?.path
        ?.renderId === statementRenderId,
  ).length;
}
