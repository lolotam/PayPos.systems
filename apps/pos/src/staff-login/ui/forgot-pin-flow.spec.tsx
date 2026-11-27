import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t, type Locale } from '@pospay/i18n';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { PinForm } from './pin-form';

const calls = vi.hoisted(() => ({
  signIn: vi.fn(),
  changePin: vi.fn(),
  request: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('../api/staff-calls', () => ({
  signInStaffPin: calls.signIn,
  changeTemporaryStaffPin: calls.changePin,
  requestStaffPinReset: calls.request,
  resetStaffPinWithOtp: calls.reset,
}));
const challengeId = '01920000-0000-7000-8000-000000000002';
const email = 'cashier@example.com';
const label = (key: Parameters<typeof t>[1]) => t('ar' as Locale, key);
const display = () =>
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <PinForm onSignedIn={vi.fn()} />
    </LocaleProvider>,
  );
const type = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
function openFlow() {
  display();
  press(label('staffLogin.forgotPin'));
}
function requestWithEmail() {
  type(label('staffLogin.forgotPinEmail'), email);
  press(label('staffLogin.forgotPinSend'));
}
async function advanceToPinStep() {
  requestWithEmail();
  fireEvent.change(await screen.findByLabelText(label('staffLogin.code')), {
    target: { value: '123456' },
  });
  press(label('staffLogin.forgotPinContinue'));
  await screen.findByLabelText(label('staffLogin.newPin'));
}
async function reachPinStep() {
  openFlow();
  await advanceToPinStep();
}
function typePins(pin: string, confirmation: string) {
  type(label('staffLogin.newPin'), pin);
  type(label('staffLogin.confirmPin'), confirmation);
  press(label('staffLogin.changePinSubmit'));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  calls.request.mockResolvedValue({ kind: 'accepted', challengeId });
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('resets the PIN by email code and returns to sign-in with a visible confirmation', async () => {
  calls.reset.mockResolvedValue('reset');
  await reachPinStep();
  expect(calls.request).toHaveBeenCalledWith({ channel: 'EMAIL', identifier: email, locale: 'ar' });
  typePins('5678', '5678');
  await waitFor(() =>
    expect(calls.reset).toHaveBeenCalledWith({
      challenge_id: challengeId,
      code: '123456',
      pin: '5678',
    }),
  );
  expect((await screen.findByRole('alert')).textContent).toBe(label('staffLogin.forgotPinDone'));
  expect(screen.getByLabelText(label('staffLogin.ownPin'))).not.toBeNull();
  expect(screen.queryByLabelText(label('staffLogin.newPin'))).toBeNull();
  expect(document.body.textContent).not.toContain('123456');
});

it('shows an unavailable alert for WhatsApp and keeps the email option working', async () => {
  calls.request.mockResolvedValueOnce({ kind: 'unavailable' });
  openFlow();
  fireEvent.click(
    screen.getByRole('radio', { name: label('staffLogin.forgotPinChannelWhatsapp') }),
  );
  type(label('staffLogin.phone'), '+96550000001');
  press(label('staffLogin.forgotPinSend'));
  expect((await screen.findByRole('alert')).textContent).toBe(
    label('staffLogin.forgotPinChannelUnavailable'),
  );
  expect(screen.queryByLabelText(label('staffLogin.code'))).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: label('staffLogin.forgotPinChannelEmail') }));
  requestWithEmail();
  expect(await screen.findByLabelText(label('staffLogin.code'))).not.toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('refuses a mismatched or malformed new PIN before it reaches the server', async () => {
  await reachPinStep();
  typePins('5678', '1234');
  expect((await screen.findByRole('alert')).textContent).toBe(label('staffLogin.pinMismatch'));
  typePins('12', '12');
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(label('staffLogin.pinFormatInvalid')),
  );
  expect(calls.reset).not.toHaveBeenCalled();
});

it('tells the cashier a wrong or expired code was refused and asks for the code again', async () => {
  calls.reset.mockResolvedValue('invalid');
  await reachPinStep();
  typePins('5678', '5678');
  expect((await screen.findByRole('alert')).textContent).toBe(label('staffLogin.forgotPinInvalid'));
  const code = screen.getByLabelText(label('staffLogin.code')) as HTMLInputElement;
  expect(code.value).toBe('');
});

it('lets the cashier go back to sign-in from every step', async () => {
  openFlow();
  press(label('staffLogin.changePinCancel'));
  expect(screen.getByLabelText(label('staffLogin.ownPin'))).not.toBeNull();
  press(label('staffLogin.forgotPin'));
  await advanceToPinStep();
  press(label('staffLogin.changePinCancel'));
  expect(screen.getByLabelText(label('staffLogin.ownPin'))).not.toBeNull();
});
