import { onlineManager } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { USER, deferredAnswer, emptyRefusal, ok, refusal } from '../../api/__tests__/plan-http';
import {
  BUSINESS_ID, EMPLOYEE_SARA, EMPLOYEE_RANA, PERIOD, businessView, branchView,
  closedView, closedBranchView, statementEmployee,
} from '../../api/__tests__/statement-http';
import { renderStatementPage, serveReading } from './statement-page-harness';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const S = (key: string) => t('en', `commissionStatementScreen.${key}` as never);
const current = { answer: ok(closedView()) };
const payment = {
  paid_on: '2026-11-19', paid_method: 'CASH' as const, paid_note: '<b>Paid in person</b>',
  paid_at: '2026-11-20T09:00:00.000Z', paid_by: USER, paid_total: '15.505',
  payments: [{ employee_id: EMPLOYEE_SARA, exact_payable: '15.503', paid_amount: '15.505' }],
};
const response = { ...payment, business_id: BUSINESS_ID, period: PERIOD, status: 'PAID' };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  current.answer = ok(closedView());
  serveReading(api, current);
});
afterEach(() => { cleanup(); onlineManager.setOnline(true); vi.useRealTimers(); });

async function open() {
  renderStatementPage();
  fireEvent.click(await screen.findByRole('button', { name: S('pay') }));
  return screen.findByRole('dialog');
}
async function confirm() {
  const button = screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}
const keyOf = (index: number) => api.POST.mock.calls[index]?.[1].params.header['Idempotency-Key'];

it.each([
  ['not generated', () => businessView({ generated: false }), false],
  ['draft', businessView, false],
  ['reviewed', () => businessView({ status: 'REVIEWED' }), false],
  ['approved business', closedView, true],
  ['paid business', () => closedView({ status: 'PAID', payment }), false],
  ['open branch', branchView, false],
  ['approved branch', closedBranchView, false],
  ['paid branch', () => closedBranchView({ status: 'PAID', payment }), false],
] as const)('%s: shows payment only for an approved whole-business reading', async (_label, view, shown) => {
  current.answer = ok(view());
  renderStatementPage();
  await screen.findByLabelText('Sara');
  expect(screen.queryByRole('button', { name: S('pay') }) !== null).toBe(shown);
});

it('shows exact employee payables and their signed sum, with server rounding explained', async () => {
  current.answer = ok(closedView({ employees: [
    statementEmployee({ payable: '15.503' }),
    statementEmployee({ employee_id: EMPLOYEE_RANA, name_en: 'Rana', payable: '-2.001' }),
  ] }));
  const dialog = await open();
  expect(within(dialog).getByText('15.503')).toBeTruthy();
  expect(within(dialog).getByText('-2.001')).toBeTruthy();
  expect(within(dialog).getByText('13.502')).toBeTruthy();
  expect(within(dialog).getByText(S('exactTotal'), { exact: false })).toBeTruthy();
  expect(within(dialog).getByText(S('cashRounding'))).toBeTruthy();
  expect(within(dialog).getByText(S('paidOnHint'))).toBeTruthy();
  expect((screen.getByLabelText(S('paidOn')) as HTMLInputElement).value).toBe('2026-11-20');
  expect(within(dialog).getAllByRole('option').map((option) => option.textContent)).toEqual([
    S('methodSalary'), S('methodBank'), S('methodCash'),
  ]);
});

it('shows PAID and the server payment immediately even if the following read fails', async () => {
  api.POST.mockImplementation(async () => {
    current.answer = emptyRefusal(500);
    return ok(response);
  });
  await open();
  fireEvent.change(screen.getByLabelText(S('paidMethod')), { target: { value: 'CASH' } });
  fireEvent.change(screen.getByLabelText(S('paidOn')), { target: { value: '2026-11-19' } });
  fireEvent.change(screen.getByLabelText(S('paidNote')), { target: { value: '  Paid in person  ' } });
  await confirm();
  expect(await screen.findByText(S('donePaid'))).toBeTruthy();
  expect(screen.getByText(S('statusPaid'))).toBeTruthy();
  expect(screen.getByText(S('refreshFailed'))).toBeTruthy();
  const block = screen.getByRole('region', { name: S('paymentTitle') });
  expect(within(block).getByText('15.503')).toBeTruthy();
  expect(within(block).getAllByText('15.505')).toHaveLength(2);
  expect(within(block).getByText('<b>Paid in person</b>').querySelector('b')).toBeNull();
  expect(within(block).getByText(USER)).toBeTruthy();
  expect(within(block).getByText(payment.paid_at)).toBeTruthy();
  expect(api.POST.mock.calls[0]?.[0]).toMatch(/\/mark-paid$/);
  expect(api.POST.mock.calls[0]?.[1].body).toEqual({ paid_method: 'CASH', paid_on: '2026-11-19', paid_note: 'Paid in person' });
  expect(screen.queryByRole('button', { name: S('pay') })).toBeNull();
});

it.each([
  ['COMMISSION_STATEMENT_ALREADY_PAID', 409, 'errAlreadyPaid'],
  ['COMMISSION_STATEMENT_NOT_APPROVED', 409, 'errNotApproved'],
  ['COMMISSION_PAID_ON_INVALID', 422, 'errPaidOnInvalid'],
  ['COMMISSION_PAYABLE_TOO_LARGE', 422, 'errPayableTooLarge'],
  ['FORBIDDEN', 403, 'errForbidden'],
  ['FEATURE_DISABLED', 403, 'errFeatureDisabled'],
  ['COMMISSION_PERIOD_CLOSED', 409, 'errPeriodClosed'],
  ['VALIDATION_FAILED', 400, 'errPaymentValidation'],
  ['IDEMPOTENCY_KEY_REUSED', 422, 'errKeyReused'],
  ['IDEMPOTENCY_KEY_REQUIRED', 400, 'errKeyRequired'],
  ['IDEMPOTENCY_KEY_IN_PROGRESS', 409, 'errBusy'],
  ['NOT_READY', 503, 'errNotReady'],
] as const)('shows a readable %s response', async (code, status, message) => {
  api.POST.mockResolvedValue(refusal(status, code));
  await open();
  await confirm();
  expect(await screen.findByText(S(message))).toBeTruthy();
  expect(screen.queryByText(code)).toBeNull();
  expect(screen.getByRole('dialog')).toBeTruthy();
});

it.each(['status', 'input_fingerprint', 'statement_fingerprint', 'reader_scope'] as const)(
  'sends no payment if %s changes after opening', async (field) => {
    await open();
    const changed = field === 'reader_scope' ? closedBranchView() : closedView({
      [field]: field === 'status' ? 'PAID' : 'c'.repeat(64),
    });
    current.answer = ok(changed);
    await confirm();
    expect(await screen.findByText(S('errStale'))).toBeTruthy();
    expect(api.POST).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: S('reload') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  },
);

it('shows only the branch payment fields and rows returned by the server', async () => {
  current.answer = ok(closedBranchView({ status: 'PAID', payment: {
    paid_on: payment.paid_on, paid_method: payment.paid_method, payments: payment.payments,
  } }));
  renderStatementPage();
  const block = await screen.findByRole('region', { name: S('paymentTitle') });
  expect(within(block).getByText('Sara')).toBeTruthy();
  expect(within(block).getByText('15.503')).toBeTruthy();
  expect(within(block).getByText('15.505')).toBeTruthy();
  expect(within(block).queryByText('Rana')).toBeNull();
  for (const key of ['paidTotal', 'paidNote', 'paidAt', 'paidBy']) expect(within(block).queryByText(S(key))).toBeNull();
});

it('omits an empty note and refuses an overlong note visibly before sending', async () => {
  api.POST.mockResolvedValue(refusal(422, 'COMMISSION_PAID_ON_INVALID'));
  await open();
  fireEvent.change(screen.getByLabelText(S('paidNote')), { target: { value: 'x'.repeat(501) } });
  expect(await screen.findByText(S('errPaymentValidation'))).toBeTruthy();
  expect((screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.POST).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(S('paidNote')), { target: { value: '  ' } });
  await confirm();
  expect(await screen.findByText(S('errPaidOnInvalid'))).toBeTruthy();
  expect(api.POST.mock.calls[0]?.[1].body.paid_note).toBeUndefined();
});

it.each([502, 503, 504, 'network'] as const)('keeps the attempt after %s and replaces it after a real answer', async (gateway) => {
  if (gateway === 'network') api.POST.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else api.POST.mockResolvedValueOnce(emptyRefusal(gateway));
  api.POST.mockResolvedValueOnce(refusal(422, 'COMMISSION_PAID_ON_INVALID'));
  await open();
  await confirm();
  await screen.findByText(S('errGeneric'));
  await confirm();
  await screen.findByText(S('errPaidOnInvalid'));
  api.POST.mockResolvedValue(refusal(409, 'COMMISSION_STATEMENT_ALREADY_PAID'));
  await confirm();
  expect(await screen.findByText(S('errAlreadyPaid'))).toBeTruthy();
  expect(keyOf(1)).toBe(keyOf(0));
  expect(keyOf(2)).not.toBe(keyOf(1));
});

it('drops a lost attempt when the dialog closes', async () => {
  api.POST.mockRejectedValue(new TypeError('Failed to fetch'));
  await open();
  await confirm();
  await screen.findByText(S('errGeneric'));
  fireEvent.click(screen.getByRole('button', { name: S('cancel') }));
  fireEvent.click(screen.getByRole('button', { name: S('pay') }));
  await confirm();
  expect(await screen.findByText(S('errGeneric'))).toBeTruthy();
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('uses a different key when the payload changes after a lost answer', async () => {
  api.POST.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await open();
  await confirm();
  await screen.findByText(S('errGeneric'));
  fireEvent.change(screen.getByLabelText(S('paidMethod')), { target: { value: 'BANK_TRANSFER' } });
  api.POST.mockResolvedValue(refusal(422, 'COMMISSION_PAID_ON_INVALID'));
  await confirm();
  expect(await screen.findByText(S('errPaidOnInvalid'))).toBeTruthy();
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('sends an offline confirmation immediately and displays the network failure', async () => {
  await open();
  api.POST.mockRejectedValue(new TypeError('Failed to fetch'));
  onlineManager.setOnline(false);
  await confirm();
  expect(await screen.findByText(S('errGeneric'))).toBeTruthy();
  expect(api.POST).toHaveBeenCalledTimes(1);
});

it('disables recording payment while a read is in progress', async () => {
  renderStatementPage();
  const button = await screen.findByRole('button', { name: S('pay') });
  const refresh = deferredAnswer();
  api.GET.mockReturnValue(refresh.promise);
  fireEvent.click(button);
  await confirm();
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByRole('button', { name: S('working') })).toBeTruthy();
  refresh.resolve(emptyRefusal(500));
  expect(await screen.findByText(S('refreshFailed'))).toBeTruthy();
});
