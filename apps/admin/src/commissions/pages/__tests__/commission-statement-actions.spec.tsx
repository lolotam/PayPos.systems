import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { ok, refusal, type ApiAnswer } from '../../api/__tests__/plan-http';
import {
  EMPLOYEE_SARA,
  FP_INPUT,
  FP_STATEMENT,
  businessView,
} from '../../api/__tests__/statement-http';
import { renderStatementPage, serveReading } from './statement-page-harness';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const S = (key: string) => t('en', `commissionStatementScreen.${key}` as never);
const current = { answer: ok(businessView()) };
const FINGERPRINTS = { expected_fingerprint: FP_INPUT, expected_statement_fingerprint: FP_STATEMENT };
const reviewedResult = { status: 'REVIEWED', reviewed_fingerprint: FP_INPUT, reviewed_statement_fingerprint: FP_STATEMENT };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  current.answer = ok(businessView());
  serveReading(api, current);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function openDialog(button: string) {
  renderStatementPage();
  await screen.findByLabelText('Sara');
  fireEvent.click(screen.getByRole('button', { name: button }));
  return screen.findByRole('dialog');
}

function confirm() {
  fireEvent.click(screen.getByRole('button', { name: S('confirm') }));
}

function postCall(index = 0) {
  const [path, options] = api.POST.mock.calls[index] ?? [];
  return { path, params: options?.params, body: options?.body };
}

it('generates after a confirmation and shows the refreshed statement', async () => {
  current.answer = ok(businessView({ generated: false }));
  api.POST.mockImplementation(async () => {
    current.answer = ok(businessView());
    return ok(businessView());
  });
  await openDialog(S('generate'));
  expect(screen.getByText(S('generateTitle'))).toBeTruthy();
  expect(api.POST).not.toHaveBeenCalled();
  confirm();
  expect(await screen.findByText(S('doneGenerated'))).toBeTruthy();
  expect(screen.getByText(S('statusDraft'))).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  const call = postCall();
  expect(call.path).toBe('/v1/businesses/{businessId}/commission-statements/{period}/generate');
  expect(call.params.header['Idempotency-Key']).toEqual(expect.any(String));
});

it('reviews with the two fingerprints the reviewer saw and shows the reviewed status', async () => {
  api.POST.mockImplementation(async () => {
    current.answer = ok(businessView({ status: 'REVIEWED', reviewed_fingerprint: FP_INPUT, reviewed_statement_fingerprint: FP_STATEMENT }));
    return ok(reviewedResult);
  });
  await openDialog(S('review'));
  confirm();
  expect(await screen.findByText(S('doneReviewed'))).toBeTruthy();
  expect(screen.getByText(S('statusReviewed'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('review') })).toBeNull();
  const call = postCall();
  expect(call.body).toEqual(FINGERPRINTS);
  expect(call.params.header['Idempotency-Key']).toEqual(expect.any(String));
});

it('answers a blocked review with a readable message and the employee behind each issue, never the code', async () => {
  const blocked = {
    error: {
      code: 'COMMISSION_STATEMENT_BLOCKED',
      message_ar: 'x',
      message_en: 'x',
      details: { issues: [{ employee_id: EMPLOYEE_SARA, code: 'NO_SALARY' }] },
    },
    response: { status: 422, ok: false },
  } satisfies ApiAnswer;
  api.POST.mockResolvedValue(blocked);
  await openDialog(S('review'));
  confirm();
  const alert = await screen.findByText(S('errBlocked'));
  expect(alert.parentElement?.textContent).toContain(`Sara: ${S('issueNoSalary')}`);
  expect(screen.queryByText('COMMISSION_STATEMENT_BLOCKED')).toBeNull();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it('offers a reload when the statement changed after it was loaded, and the reload closes the dialog and reads again', async () => {
  api.POST.mockResolvedValue(refusal(409, 'COMMISSION_FINGERPRINT_STALE'));
  await openDialog(S('review'));
  confirm();
  expect(await screen.findByText(S('errStale'))).toBeTruthy();
  const reads = api.GET.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: S('reload') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(api.GET.mock.calls.length).toBeGreaterThan(reads));
});

it('requires a reason before a statement goes back to draft, then sends it', async () => {
  current.answer = ok(businessView({ status: 'REVIEWED', reviewed_fingerprint: FP_INPUT, reviewed_statement_fingerprint: FP_STATEMENT }));
  api.POST.mockImplementation(async () => {
    current.answer = ok(businessView());
    return ok({ status: 'DRAFT' });
  });
  await openDialog(S('returnToDraft'));
  const confirmButton = screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement;
  const reason = screen.getByLabelText(S('returnReasonLabel'));
  fireEvent.change(reason, { target: { value: '   ' } });
  expect(await screen.findByText(S('returnReasonRequired'))).toBeTruthy();
  expect(confirmButton.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: 'x'.repeat(501) } });
  expect(await screen.findByText(S('returnReasonTooLong'))).toBeTruthy();
  fireEvent.change(reason, { target: { value: 'A price was wrong' } });
  await waitFor(() => expect(confirmButton.disabled).toBe(false));
  fireEvent.click(confirmButton);
  expect(await screen.findByText(S('doneReturned'))).toBeTruthy();
  expect(screen.getByText(S('statusDraft'))).toBeTruthy();
  expect(postCall().body).toEqual({ reason: 'A price was wrong' });
});

it('shows the reason refusal of the server under the return form', async () => {
  current.answer = ok(businessView({ status: 'REVIEWED' }));
  api.POST.mockResolvedValue(refusal(422, 'COMMISSION_RETURN_REASON_INVALID'));
  await openDialog(S('returnToDraft'));
  fireEvent.change(screen.getByLabelText(S('returnReasonLabel')), { target: { value: 'Because' } });
  const confirmButton = screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement;
  await waitFor(() => expect(confirmButton.disabled).toBe(false));
  fireEvent.click(confirmButton);
  expect(await screen.findByText(S('errReturnReason'))).toBeTruthy();
});

it('shows a denied step as a permission message and keeps the statement on screen', async () => {
  api.POST.mockResolvedValue(refusal(403, 'FORBIDDEN'));
  await openDialog(S('refresh'));
  confirm();
  expect(await screen.findByText(S('errForbidden'))).toBeTruthy();
  expect(screen.getByLabelText('Sara')).toBeTruthy();
  expect(screen.queryByText(S('deniedTitle'))).toBeNull();
});

it('retries a lost answer with the same key, and uses a new key for the next action after success', async () => {
  api.POST.mockRejectedValueOnce(new TypeError('network down'));
  await openDialog(S('refresh'));
  confirm();
  expect(await screen.findByText(S('errGeneric'))).toBeTruthy();
  api.POST.mockImplementation(async () => ok(businessView()));
  confirm();
  expect(await screen.findByText(S('doneGenerated'))).toBeTruthy();
  const keys = () => api.POST.mock.calls.map((call) => call[1].params.header['Idempotency-Key']);
  expect(keys()[1]).toBe(keys()[0]);
  fireEvent.click(screen.getByRole('button', { name: S('refresh') }));
  await screen.findByRole('dialog');
  confirm();
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(3));
  expect(keys()[2]).not.toBe(keys()[0]);
});

it('lets the viewer leave the dialog without sending anything', async () => {
  await openDialog(S('review'));
  fireEvent.click(screen.getByRole('button', { name: S('cancel') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.POST).not.toHaveBeenCalled();
});

it('keeps both the confirm and cancel buttons closed while a step is running', async () => {
  let release: (answer: ApiAnswer) => void = () => undefined;
  api.POST.mockImplementation(() => new Promise<ApiAnswer>((resolve) => (release = resolve)));
  await openDialog(S('refresh'));
  confirm();
  const working = await screen.findByRole('button', { name: S('working') });
  expect((working as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: S('cancel') }) as HTMLButtonElement).disabled).toBe(true);
  release(ok(businessView()));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
