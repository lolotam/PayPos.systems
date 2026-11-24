import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { COMPANY, USER, ok, refusal, type ApiAnswer } from '../../api/__tests__/plan-http';
import { statementKey, statementScope } from '../../api/commission-statement-client';
import {
  BUSINESS_ID,
  EMPLOYEE_RANA,
  EMPLOYEE_SARA,
  PAYER_ID,
  closedBranchView,
  closedView,
  markPaidPath,
  markPaidResponse,
  paidView,
  statementEmployee,
  businessView,
} from '../../api/__tests__/statement-http';
import { renderStatementPage, serveReading } from './statement-page-harness';

const api = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

// ساعة العرض بتتحدد بنطاق المتصفح، فنثبّته عشان قيمة «اتسجّل في» تتأكد بالحرف.
process.env.TZ = 'Asia/Kuwait';

const S = (key: string) => t('en', `commissionStatementScreen.${key}` as never);
const APPROVED = () => closedView({ employees: paidView().employees });
const current = { answer: ok(APPROVED()) };
const READ_FAILS: ApiAnswer = { error: '', response: { status: 500, ok: false } };

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'));
  api.GET.mockReset();
  api.POST.mockReset();
  current.answer = ok(APPROVED());
  serveReading(api, current);
});

afterEach(() => cleanup());

let rendered: ReturnType<typeof renderStatementPage>;

async function openPay() {
  rendered = renderStatementPage();
  fireEvent.click(await screen.findByRole('button', { name: S('pay') }));
  return screen.findByRole('dialog');
}

function chooseMethod(label: string) {
  const method = screen.getByLabelText(S('payMethodLabel')) as HTMLSelectElement;
  fireEvent.change(method, { target: { value: label } });
}

async function submit() {
  const button = screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

const sent = () => api.POST.mock.calls[0]?.[1];

it.each([
  ['an approved month for a whole-business reader', () => APPROVED(), true],
  ['a paid month', () => paidView(), false],
  ['an approved month for a branch reader', () => closedBranchView(), false],
  ['a reviewed statement', () => businessView({ status: 'REVIEWED' }), false],
])('pay button, %s: shown is %s', async (_label, view, shown) => {
  current.answer = ok(view());
  renderStatementPage();
  await screen.findByLabelText('Sara');
  expect(screen.queryByRole('button', { name: S('pay') }) !== null).toBe(shown);
});

it('shows what each employee is owed, the statement total and the cash rounding rule before confirming', async () => {
  const dialog = await openPay();
  const view = within(dialog);
  expect(view.getByText('15.500')).toBeTruthy();
  expect(view.getByText('4.000')).toBeTruthy();
  expect(view.getByText(S('payPreviewTotal')).parentElement?.textContent).toContain('19.500');
  expect(view.getByText(S('payCashNote'))).toBeTruthy();
  expect(api.POST).not.toHaveBeenCalled();
});

it('keeps confirm closed until a method is chosen and sends the method, date and no empty note', async () => {
  api.POST.mockImplementation(async () => ok(markPaidResponse()));
  await openPay();
  const confirmButton = screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement;
  expect(confirmButton.disabled).toBe(true);
  chooseMethod('CASH');
  await submit();
  expect(await screen.findByText(S('donePaid'))).toBeTruthy();
  expect(sent().body).toEqual({ paid_method: 'CASH', paid_on: '2026-11-20' });
  expect(sent().params.header['Idempotency-Key']).toEqual(expect.any(String));
  expect(api.POST.mock.calls[0]?.[0]).toBe(markPaidPath);
});

it('sends the chosen date and the note as typed, trimmed', async () => {
  api.POST.mockImplementation(async () => ok(markPaidResponse()));
  await openPay();
  chooseMethod('WITH_SALARY');
  fireEvent.change(screen.getByLabelText(S('payPaidOnLabel')), { target: { value: '2026-11-05' } });
  fireEvent.change(screen.getByLabelText(S('payNoteLabel')), { target: { value: '  Paid with November salary  ' } });
  await submit();
  expect(await screen.findByText(S('donePaid'))).toBeTruthy();
  expect(sent().body).toEqual({
    paid_method: 'WITH_SALARY',
    paid_on: '2026-11-05',
    paid_note: 'Paid with November salary',
  });
});

it('shows the month as paid with its payment block from the answer, even when the re-read fails', async () => {
  api.POST.mockImplementation(async () => {
    current.answer = READ_FAILS;
    return ok(markPaidResponse());
  });
  await openPay();
  chooseMethod('BANK_TRANSFER');
  await submit();
  expect(await screen.findByText(S('donePaid'))).toBeTruthy();
  expect(screen.getByText(S('statusPaid'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: S('pay') })).toBeNull();
  expect(screen.getByText(S('paymentTitle'))).toBeTruthy();
  expect(screen.getByText(S('refreshFailed'))).toBeTruthy();
});

it('sends nothing when the statement changed between opening the dialog and confirming', async () => {
  await openPay();
  chooseMethod('CASH');
  current.answer = ok(paidView());
  await submit();
  expect(await screen.findByText(S('errStale'))).toBeTruthy();
  expect(api.POST).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: S('reload') }));
  expect(await screen.findByText(S('paymentTitle'))).toBeTruthy();
});

it.each([
  ['COMMISSION_STATEMENT_NOT_APPROVED', 409, 'errNotApproved', true],
  ['COMMISSION_STATEMENT_ALREADY_PAID', 409, 'errAlreadyPaid', true],
  ['COMMISSION_PAID_ON_INVALID', 422, 'errPaidOnInvalid', false],
  ['COMMISSION_PAYABLE_TOO_LARGE', 422, 'errPayableTooLarge', false],
  ['IDEMPOTENCY_KEY_REUSED', 422, 'errKeyReused', true],
  ['FORBIDDEN', 403, 'errForbidden', false],
  ['FEATURE_DISABLED', 403, 'errFeatureDisabled', false],
  ['VALIDATION_FAILED', 400, 'errInvalidRequest', false],
] as const)('answers %s in plain words, offering a reload only when the state changed', async (code, status, key, reload) => {
  api.POST.mockResolvedValue(refusal(status, code));
  await openPay();
  chooseMethod('CASH');
  await submit();
  expect(await screen.findByText(S(key))).toBeTruthy();
  expect(screen.queryByText(code)).toBeNull();
  expect(screen.queryByRole('button', { name: S('reload') }) !== null).toBe(reload);
  expect(screen.getByLabelText('Sara')).toBeTruthy();
});

it('shows a business reader the paid date, method, total, note, recording time, payer and exact against paid amounts', async () => {
  const exactVsPaid = [{ employee_id: EMPLOYEE_SARA, exact_payable: '15.502', paid_amount: '15.500' }];
  current.answer = ok(paidView({ payments: exactVsPaid, paid_total: '15.500' }));
  renderStatementPage();
  await screen.findByText(S('paymentTitle'));
  expect(screen.getByText('2026-11-05')).toBeTruthy();
  expect(screen.getByText(S('payMethodBankTransfer'))).toBeTruthy();
  expect(screen.getByText(S('paymentTotal')).parentElement?.textContent).toContain('15.500');
  expect(screen.getByText('Sent from the main account')).toBeTruthy();
  const recordedAt = screen.getByText(S('paymentRecordedAt')).parentElement?.textContent ?? '';
  expect(recordedAt).toContain('Nov');
  expect(recordedAt).toContain('2026');
  expect(recordedAt).toContain('11:30');
  expect(screen.getByText(`${PAYER_ID.slice(0, 8)}…`)).toBeTruthy();
  const row = screen.getByText('15.502').closest('tr');
  expect(row?.textContent).toContain('Sara');
  expect(row?.textContent).toContain('15.500');
});

it('tells the user which day the statement was approved and what range the date may take', async () => {
  await openPay();
  expect(screen.getByText(S('payPaidOnApprovedOn')).parentElement?.textContent).toContain('2026-11-02');
  expect(screen.getByText(S('payPaidOnHint'))).toBeTruthy();
});

it.each([
  ['a day before the approval day', '2026-10-30', true],
  ['an empty date', '', true],
  ['the approval day itself', '2026-11-02', false],
  ['a date after today, which only the server judges', '2027-01-01', false],
])('date field, %s: error shown is %s', async (_label, value, blocked) => {
  await openPay();
  chooseMethod('CASH');
  fireEvent.change(screen.getByLabelText(S('payPaidOnLabel')), { target: { value } });
  const confirmButton = screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement;
  await waitFor(() => expect(confirmButton.disabled).toBe(blocked));
  expect(screen.queryByText(S('payPaidOnInvalid')) !== null).toBe(blocked);
});

it('does not overwrite a newer, narrower cached read with the payment answer', async () => {
  api.POST.mockImplementation(async () => {
    const key = statementKey(statementScope(COMPANY, BUSINESS_ID, USER), '2026-10');
    rendered.client.setQueryData(key, closedBranchView({ employees: paidView().employees }));
    current.answer = READ_FAILS;
    return ok(markPaidResponse());
  });
  await openPay();
  chooseMethod('CASH');
  await submit();
  expect(await screen.findByText(S('donePaid'))).toBeTruthy();
  expect(screen.getByText(S('branchReaderNote'))).toBeTruthy();
  expect(screen.queryByText(S('paymentTitle'))).toBeNull();
  expect(screen.queryByText(S('statusPaid'))).toBeNull();
});

it('renders a payment note as plain text, never as markup', async () => {
  current.answer = ok(paidView({ paid_note: '<b>bold</b><script>alert(1)</script>' }));
  renderStatementPage();
  const note = await screen.findByText('<b>bold</b><script>alert(1)</script>');
  expect(note.querySelector('b, script')).toBeNull();
});

it('keeps the confirm closed and says why when the note holds a null character', async () => {
  await openPay();
  chooseMethod('CASH');
  fireEvent.change(screen.getByLabelText(S('payNoteLabel')), { target: { value: 'bad\u0000note' } });
  expect(await screen.findByText(S('payNoteInvalid'))).toBeTruthy();
  expect((screen.getByRole('button', { name: S('confirm') }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.POST).not.toHaveBeenCalled();
});

it('shows no payment block, and no pay button, for a paid month whose stored answer carried no payment', async () => {
  current.answer = ok(closedView({ status: 'PAID', payment: null }));
  renderStatementPage();
  expect(await screen.findByText(S('statusPaid'))).toBeTruthy();
  expect(screen.queryByText(S('paymentTitle'))).toBeNull();
  expect(screen.queryByRole('button', { name: S('pay') })).toBeNull();
});

it('lists only the payment rows the branch reader is given, with nothing for a partial employee', async () => {
  const rana = statementEmployee({ employee_id: EMPLOYEE_RANA, name_en: 'Rana', name_ar: null, partial: true, payable: '4.000' });
  const branchPayment = {
    paid_on: '2026-11-05',
    paid_method: 'CASH' as const,
    payments: [{ employee_id: EMPLOYEE_SARA, exact_payable: '15.502', paid_amount: '15.500' }],
  };
  current.answer = ok(closedBranchView({ status: 'PAID', payment: branchPayment, employees: [statementEmployee(), rana] }));
  renderStatementPage();
  const table = (await screen.findByText(S('paymentColEmployee'))).closest('table');
  const bodyRows = within(table as HTMLElement).getAllByRole('row').slice(1);
  expect(bodyRows).toHaveLength(1);
  expect(bodyRows[0]?.textContent).toContain('Sara');
  expect(within(table as HTMLElement).queryByText('Rana')).toBeNull();
  expect(screen.getByLabelText('Rana')).toBeTruthy();
});

it('gives a branch reader only the paid date, method and her own rows', async () => {
  const branchPayment = {
    paid_on: '2026-11-05',
    paid_method: 'CASH' as const,
    payments: [{ employee_id: EMPLOYEE_SARA, exact_payable: '15.502', paid_amount: '15.500' }],
  };
  current.answer = ok(closedBranchView({ status: 'PAID', payment: branchPayment }));
  renderStatementPage();
  await screen.findByText(S('paymentTitle'));
  expect(screen.getByText(S('payMethodCash'))).toBeTruthy();
  expect(screen.getByText('15.502').closest('tr')?.textContent).toContain('15.500');
  for (const hidden of ['paymentTotal', 'paymentNote', 'paymentRecordedAt', 'paymentRecordedBy']) {
    expect(screen.queryByText(S(hidden))).toBeNull();
  }
});
