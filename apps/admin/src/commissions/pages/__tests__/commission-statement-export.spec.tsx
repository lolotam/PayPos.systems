import { commissionStatementRenderErrors, t } from '@pospay/i18n';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COMPANY, ok, refusal, type ApiAnswer } from '../../api/__tests__/plan-http';
import {
  BUSINESS_ID,
  PERIOD,
  businessView,
  closedBranchView,
  closedView,
  paidView,
} from '../../api/__tests__/statement-http';
import { renderStatementPage } from './statement-page-harness';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
const ui = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => ui.locale }));

const RENDER_ID = '01920000-0000-7c55-8a55-0000000000a5';
const EXPORTS = '/v1/businesses/{businessId}/commission-statements/{period}/exports';
const STATUS = `${EXPORTS}/{renderId}`;
const DOWNLOAD = `${STATUS}/download`;

const S = (key: string) => t(ui.locale, `commissionStatementScreen.${key}` as never);
const reading = { answer: ok(closedView()) as ApiAnswer };
const statuses: { queue: ApiAnswer[] } = { queue: [] };
const saved: string[] = [];
const accepted = () => ok({ render_id: RENDER_ID });
const state = (value: string, extra: object = {}) => ok({ state: value, ...extra });
const blobRefusal = (status: number, code: string): ApiAnswer => ({
  error: { text: async () => JSON.stringify({ code }) },
  response: { status, ok: false },
});

beforeEach(() => {
  ui.locale = 'en';
  api.GET.mockReset();
  api.POST.mockReset();
  statuses.queue = [state('QUEUED')];
  saved.length = 0;
  reading.answer = ok(closedView());
  api.GET.mockImplementation(async (path: string) => {
    if (path !== STATUS) return reading.answer;
    return statuses.queue.length > 1 ? statuses.queue.shift() : statuses.queue[0];
  });
  api.POST.mockImplementation(async (path: string) => {
    if (path === EXPORTS) return accepted();
    return { data: new Blob(['xlsx']), response: { status: 200, ok: true } };
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openExport() {
  renderStatementPage();
  fireEvent.click(await screen.findByRole('button', { name: S('exportExcel') }));
  return screen.findByRole('dialog');
}

const exportButton = () => screen.queryByRole('button', { name: S('exportExcel') });
const startButton = () => screen.findByRole('button', { name: S('exportStart') });
const startCall = () => api.POST.mock.calls.find((call) => call[0] === EXPORTS);

it.each([
  ['an approved month, whole-business reader', () => closedView(), true],
  ['a paid month, whole-business reader', () => paidView(), true],
  ['an approved month, branch reader', () => closedBranchView(), true],
  ['a paid month, branch reader', () => closedBranchView({ status: 'PAID' }), true],
  ['a draft', () => businessView({ status: 'DRAFT' }), false],
  ['a reviewed statement', () => businessView({ status: 'REVIEWED' }), false],
  ['a month nobody generated yet', () => businessView({ generated: false }), false],
])('export button, %s: shown is %s', async (_label, view, shown) => {
  reading.answer = ok(view());
  renderStatementPage();
  await screen.findByRole('heading', { name: S('pageTitle') });
  await waitFor(() => expect(screen.queryByText(S('loading'))).toBeNull());
  expect(exportButton() !== null).toBe(shown);
});

it('defaults the file language to the screen language and sends the chosen one with no idempotency key', async () => {
  await openExport();
  expect((screen.getByLabelText(S('exportLanguageEn')) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByLabelText(S('exportLanguageAr')));
  fireEvent.click(await startButton());
  await screen.findByText(S('exportWaiting'));
  expect(startCall()?.[1]).toEqual({
    params: {
      header: { 'x-company-id': COMPANY },
      path: { businessId: BUSINESS_ID, period: PERIOD },
    },
    body: { language: 'ar' },
  });
  expect(JSON.stringify(startCall()?.[1])).not.toContain('Idempotency-Key');
});

it('starts in Arabic on an Arabic screen when the user changes nothing', async () => {
  ui.locale = 'ar';
  await openExport();
  expect((screen.getByLabelText(S('exportLanguageAr')) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(await startButton());
  await screen.findByText(S('exportWaiting'));
  expect((startCall()?.[1] as { body: unknown }).body).toEqual({ language: 'ar' });
});

it('locks the language while the file is being prepared', async () => {
  await openExport();
  fireEvent.click(await startButton());
  await screen.findByText(S('exportWaiting'));
  expect(screen.getByLabelText(S('exportLanguageEn')).matches(':disabled')).toBe(true);
  expect(screen.getByLabelText(S('exportLanguageAr')).matches(':disabled')).toBe(true);
});

it('moves from waiting to ready on the next poll', async () => {
  statuses.queue = [state('QUEUED'), state('READY')];
  await openExport();
  fireEvent.click(await startButton());
  expect((await screen.findByRole('status')).textContent).toContain(S('exportWaiting'));
  expect(await screen.findByText(S('exportReady'), {}, { timeout: 5_000 })).toBeTruthy();
  expect(screen.getByRole('button', { name: S('exportDownload') })).toBeTruthy();
});

it('downloads the workbook as commission-statement-2026-10.xlsx and offers a new export afterwards', async () => {
  statuses.queue = [state('READY')];
  await openExport();
  fireEvent.click(await startButton());
  fireEvent.click(await screen.findByRole('button', { name: S('exportDownload') }));
  await screen.findByText(S('exportDownloaded'));
  expect(saved).toEqual(['commission-statement-2026-10.xlsx']);
  const call = api.POST.mock.calls.find((entry) => entry[0] === DOWNLOAD);
  expect(call?.[1]).toMatchObject({
    params: {
      header: { 'x-company-id': COMPANY },
      path: { businessId: BUSINESS_ID, period: PERIOD, renderId: RENDER_ID },
    },
    parseAs: 'blob',
  });
  fireEvent.click(screen.getByRole('button', { name: S('exportNew') }));
  expect(await startButton()).toBeTruthy();
  expect(screen.getByLabelText(S('exportLanguageEn')).matches(':disabled')).toBe(false);
});

it('shows the readable unavailable message when the render fails, never the raw code', async () => {
  statuses.queue = [state('FAILED', { error_code: 'COMMISSION_STATEMENT_UNAVAILABLE' })];
  await openExport();
  fireEvent.click(await startButton());
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(
    commissionStatementRenderErrors.COMMISSION_STATEMENT_UNAVAILABLE.message_en,
  );
  expect(screen.getByRole('dialog').textContent).not.toContain('COMMISSION_STATEMENT_UNAVAILABLE');
  expect(screen.getByRole('button', { name: S('exportNew') })).toBeTruthy();
});

it.each([
  [429, 'COMMISSION_STATEMENT_EXPORT_RATE_LIMITED', 'exportErrRateLimited'],
  [409, 'COMMISSION_STATEMENT_NOT_APPROVED', 'exportErrNotApproved'],
  [403, 'FORBIDDEN', 'errForbidden'],
])(
  'a %s refusal of the request reads as a message and lets the user start again',
  async (status, code, key) => {
    api.POST.mockImplementation(async () => refusal(status, code));
    await openExport();
    fireEvent.click(await startButton());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(S(key));
    expect(screen.getByRole('dialog').textContent).not.toContain(code);
    expect(screen.getByRole('button', { name: S('exportStart') })).toBeTruthy();
  },
);

it('tells the user the export expired when its status is gone, and offers a new one', async () => {
  statuses.queue = [refusal(404, 'NOT_FOUND')];
  await openExport();
  fireEvent.click(await startButton());
  expect((await screen.findByRole('alert')).textContent).toContain(S('exportExpired'));
  expect(screen.getByRole('button', { name: S('exportNew') })).toBeTruthy();
});

it('recovers from a failed status check with check again', async () => {
  statuses.queue = [refusal(500, 'INTERNAL_ERROR'), state('READY')];
  await openExport();
  fireEvent.click(await startButton());
  expect((await screen.findByRole('alert')).textContent).toContain(S('exportErrGeneric'));
  fireEvent.click(screen.getByRole('button', { name: S('exportCheckAgain') }));
  expect(await screen.findByText(S('exportReady'))).toBeTruthy();
});

it('keeps the download retryable after a temporary failure and reports an expired file as expired', async () => {
  statuses.queue = [state('READY')];
  let attempts = 0;
  api.POST.mockImplementation(async (path: string) => {
    if (path === EXPORTS) return accepted();
    attempts += 1;
    return attempts === 1
      ? blobRefusal(409, 'DOCUMENT_NOT_READY')
      : blobRefusal(410, 'DOCUMENT_EXPIRED');
  });
  await openExport();
  fireEvent.click(await startButton());
  fireEvent.click(await screen.findByRole('button', { name: S('exportDownload') }));
  expect((await screen.findByRole('alert')).textContent).toContain(S('exportTimeout'));
  fireEvent.click(screen.getByRole('button', { name: S('exportDownload') }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(S('exportExpired')));
  expect(screen.queryByRole('button', { name: S('exportDownload') })).toBeNull();
  expect(saved).toEqual([]);
});

it('closes the dialog from its close button', async () => {
  await openExport();
  fireEvent.click(screen.getByRole('button', { name: S('exportClose') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

const statusCalls = () => api.GET.mock.calls.filter((call) => call[0] === STATUS).length;

it('stops polling at the 60 second deadline and recovers with check again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    statuses.queue = [state('QUEUED')];
    await openExport();
    fireEvent.click(await startButton());
    await screen.findByText(S('exportWaiting'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(await screen.findByText(S('exportTimeout'))).toBeTruthy();
    const stopped = statusCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(statusCalls()).toBe(stopped);
    statuses.queue = [state('READY')];
    fireEvent.click(screen.getByRole('button', { name: S('exportCheckAgain') }));
    expect(await screen.findByText(S('exportReady'))).toBeTruthy();
    expect(screen.queryByText(S('exportTimeout'))).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
