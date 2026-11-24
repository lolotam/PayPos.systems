import { onlineManager } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { ok, refusal, type ApiAnswer } from '../../api/__tests__/plan-http';
import {
  FP_INPUT,
  FP_STATEMENT,
  businessView,
  closedView,
} from '../../api/__tests__/statement-http';
import { renderStatementPage, serveReading } from './statement-page-harness';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const S = (key: string) => t('en', `commissionStatementScreen.${key}` as never);
const current = { answer: ok(businessView()) };
const reviewedBy = (print: string) =>
  businessView({ status: 'REVIEWED', reviewed_fingerprint: print.repeat(64), reviewed_statement_fingerprint: FP_STATEMENT });
const REVIEWED = () => reviewedBy('c');
const reviewResult = { status: 'REVIEWED', reviewed_fingerprint: FP_INPUT, reviewed_statement_fingerprint: FP_STATEMENT };
const GATEWAY_DOWN: ApiAnswer = { error: '', response: { status: 503, ok: false } };
const READ_FAILS: ApiAnswer = { error: '', response: { status: 500, ok: false } };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  current.answer = ok(businessView());
  serveReading(api, current);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
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

async function confirmReturn(reason = 'A price was wrong') {
  fireEvent.change(screen.getByLabelText(S('returnReasonLabel')), { target: { value: reason } });
  const button = screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

const keyOf = (index: number) => api.POST.mock.calls[index]?.[1].params.header['Idempotency-Key'];

it.each([
  ['generate', S('refresh'), () => businessView(), () => businessView({ current_fingerprint: 'e'.repeat(64) })],
  ['review', S('review'), () => businessView(), () => businessView({ current_statement_fingerprint: 'e'.repeat(64) })],
  ['approve', S('approve'), REVIEWED, () => businessView()],
  ['return', S('returnToDraft'), REVIEWED, () => reviewedBy('e')],
] as const)('%s: sends nothing when the statement changed between opening the dialog and confirming', async (pick, button, before, after) => {
  current.answer = ok(before());
  await openDialog(button);
  current.answer = ok(after());
  if (pick === 'return') await confirmReturn();
  else confirm();
  expect(await screen.findByText(S('errStale'))).toBeTruthy();
  expect(api.POST).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: S('reload') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('shows the changed statement after the reload that follows a refused confirm', async () => {
  current.answer = ok(REVIEWED());
  await openDialog(S('approve'));
  current.answer = ok(businessView());
  confirm();
  fireEvent.click(await screen.findByRole('button', { name: S('reload') }));
  expect(await screen.findByText(S('statusDraft'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('approve') })).toBeNull();
});

it('sends the confirm when the fresh read is the very version the dialog opened on', async () => {
  current.answer = ok(REVIEWED());
  api.POST.mockResolvedValue(ok({ status: 'DRAFT' }));
  await openDialog(S('returnToDraft'));
  await confirmReturn();
  expect(await screen.findByText(S('doneReturned'))).toBeTruthy();
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('uses a new key for the same return typed in a later dialog, after a lost answer', async () => {
  current.answer = ok(REVIEWED());
  api.POST.mockRejectedValueOnce(new TypeError('network down'));
  await openDialog(S('returnToDraft'));
  await confirmReturn();
  expect(await screen.findByText(S('errGeneric'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: S('cancel') }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  api.POST.mockResolvedValue(ok({ status: 'DRAFT' }));
  fireEvent.click(screen.getByRole('button', { name: S('returnToDraft') }));
  await screen.findByRole('dialog');
  await confirmReturn();
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('keeps the key through a gateway 503 inside the same dialog and drops it after a real refusal', async () => {
  current.answer = ok(REVIEWED());
  api.POST.mockResolvedValueOnce(GATEWAY_DOWN).mockResolvedValueOnce(refusal(422, 'COMMISSION_RETURN_REASON_INVALID'));
  await openDialog(S('returnToDraft'));
  await confirmReturn();
  await screen.findByText(S('errGeneric'));
  fireEvent.click(screen.getByRole('button', { name: S('confirm') }));
  await screen.findByText(S('errReturnReason'));
  api.POST.mockResolvedValue(ok({ status: 'DRAFT' }));
  fireEvent.click(screen.getByRole('button', { name: S('confirm') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(3));
  expect(keyOf(1)).toBe(keyOf(0));
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('drops the key when a 503 carries an API envelope, because the server refused before writing', async () => {
  current.answer = ok(REVIEWED());
  api.POST.mockResolvedValueOnce(refusal(503, 'NOT_READY')).mockResolvedValue(ok({ status: 'DRAFT' }));
  await openDialog(S('returnToDraft'));
  await confirmReturn();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: S('confirm') }));
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('keeps the key while the first attempt is still being processed', async () => {
  api.POST.mockResolvedValueOnce(refusal(409, 'IDEMPOTENCY_KEY_IN_PROGRESS')).mockResolvedValue(ok(businessView()));
  await openDialog(S('refresh'));
  confirm();
  await screen.findByText(S('errBusy'));
  confirm();
  await waitFor(() => expect(api.POST).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
});

it('shows an approved month at once from the approval answer even when the re-read fails, and says so', async () => {
  current.answer = ok(REVIEWED());
  api.POST.mockImplementation(async () => {
    current.answer = READ_FAILS;
    return ok(closedView());
  });
  await openDialog(S('approve'));
  confirm();
  expect(await screen.findByText(S('doneApproved'))).toBeTruthy();
  expect(screen.getByText(S('statusApproved'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('approve') })).toBeNull();
  expect(screen.queryByRole('button', { name: S('returnToDraft') })).toBeNull();
  expect(screen.getByText(S('refreshFailed'))).toBeTruthy();
});

it('shows the reviewed state from the review answer and keeps every button off until the re-read works', async () => {
  api.POST.mockImplementation(async () => {
    current.answer = READ_FAILS;
    return ok(reviewResult);
  });
  await openDialog(S('review'));
  confirm();
  expect(await screen.findByText(S('doneReviewed'))).toBeTruthy();
  expect(screen.getByText(S('statusReviewed'))).toBeTruthy();
  const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
  expect(disabled(S('approve'))).toBe(true);
  expect(disabled(S('returnToDraft'))).toBe(true);
  expect(disabled(S('refresh'))).toBe(true);
  current.answer = ok(
    businessView({ status: 'REVIEWED', reviewed_fingerprint: FP_INPUT, reviewed_statement_fingerprint: FP_STATEMENT }),
  );
  fireEvent.click(screen.getByRole('button', { name: S('retry') }));
  await waitFor(() => expect(disabled(S('approve'))).toBe(false));
  expect(screen.queryByText(S('refreshFailed'))).toBeNull();
});

it('shows the draft from the return answer when the re-read fails afterwards', async () => {
  current.answer = ok(REVIEWED());
  api.POST.mockImplementation(async () => {
    current.answer = READ_FAILS;
    return ok({ status: 'DRAFT' });
  });
  await openDialog(S('returnToDraft'));
  await confirmReturn();
  expect(await screen.findByText(S('doneReturned'))).toBeTruthy();
  expect(screen.getByText(S('statusDraft'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('approve') })).toBeNull();
});

it.each([
  ['a lost permission', refusal(403, 'FORBIDDEN'), S('deniedTitle')],
  ['a missing business', refusal(404, 'BUSINESS_NOT_FOUND'), S('deniedTitle')],
  ['a disabled feature', refusal(403, 'FEATURE_DISABLED'), S('errFeatureDisabled')],
] as const)('hides the statement it already showed when the re-read after a write answers %s', async (_label, answer, message) => {
  api.POST.mockImplementation(async () => {
    current.answer = answer;
    return ok(businessView());
  });
  await openDialog(S('refresh'));
  confirm();
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByLabelText('Sara')).toBeNull();
  expect(screen.queryByRole('button', { name: S('refresh') })).toBeNull();
});

it('answers an offline confirm at once with the network message instead of waiting for the network', async () => {
  api.POST.mockRejectedValue(new TypeError('Failed to fetch'));
  await openDialog(S('refresh'));
  onlineManager.setOnline(false);
  confirm();
  expect(await screen.findByText(S('errGeneric'))).toBeTruthy();
  expect(api.POST).toHaveBeenCalledTimes(1);
});
