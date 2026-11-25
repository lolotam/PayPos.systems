import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { PinForm } from './pin-form';

const calls = vi.hoisted(() => ({ signIn: vi.fn(), changePin: vi.fn() }));
vi.mock('../api/staff-calls', () => ({
  signInStaffPin: calls.signIn,
  changeTemporaryStaffPin: calls.changePin,
}));
const value = String(10).padStart(4, '0');
const proof = 'synthetic-proof-value-1234';
const display = (done = vi.fn()) =>
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <PinForm onSignedIn={done} />
    </LocaleProvider>,
  );
function submit() {
  fireEvent.change(screen.getByLabelText(t('ar', 'staffLogin.phone')), {
    target: { value: '+99900000001' },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'staffLogin.ownPin')), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.pinSignIn') }));
}
function typeNewPin(pin: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText(t('ar', 'staffLogin.newPin')), { target: { value: pin } });
  fireEvent.change(screen.getByLabelText(t('ar', 'staffLogin.confirmPin')), {
    target: { value: confirmation },
  });
}
function saveNewPin() {
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.changePinSubmit') }));
}
function storageDump(store: Storage) {
  const parts: string[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key !== null) parts.push(`${key}=${store.getItem(key) ?? ''}`);
  }
  return parts.join('&');
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
});
it('shows identical own-PIN guidance and a generic refusal, clearing PIN after a comparison', async () => {
  calls.signIn.mockResolvedValue(null);
  display();
  submit();
  expect((await screen.findByRole('alert')).textContent).toBe(t('ar', 'staffLogin.pinInvalid'));
  expect(screen.getByText(t('ar', 'staffLogin.recovery'))).not.toBeNull();
  expect((screen.getByLabelText(t('ar', 'staffLogin.ownPin')) as HTMLInputElement).value).toBe('');
  expect(localStorage.getItem('staff-pin')).toBeNull();
});
it('calls the session invalidation only for a server-verified result and clears credentials on unmount', async () => {
  const done = vi.fn();
  calls.signIn.mockResolvedValue({ user_id: 'synthetic' });
  const view = display(done);
  submit();
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  view.unmount();
  display();
  expect((screen.getByLabelText(t('ar', 'staffLogin.phone')) as HTMLInputElement).value).toBe('');
});
it('refuses offline proof and discards a result that arrives after the form is unmounted', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const offline = display();
  submit();
  await waitFor(() => expect(calls.signIn).not.toHaveBeenCalled());
  offline.unmount();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  let release: (value: unknown) => void = () => undefined;
  calls.signIn.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const done = vi.fn(),
    online = display(done);
  submit();
  await waitFor(() => expect(calls.signIn).toHaveBeenCalledOnce());
  online.unmount();
  release({ user_id: 'synthetic' });
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
});
it('opens the temporary-PIN screen when the server refuses the PIN and asks for a change', async () => {
  calls.signIn.mockResolvedValue({ kind: 'change_required', proof });
  display();
  submit();
  const heading = await screen.findByRole('heading', {
    name: t('ar', 'staffLogin.changePinTitle'),
  });
  expect(heading.textContent).toBe(t('ar', 'staffLogin.changePinTitle'));
  expect(screen.getByText(t('ar', 'staffLogin.changePinPrompt'))).not.toBeNull();
  expect(screen.getByLabelText(t('ar', 'staffLogin.newPin'))).not.toBeNull();
  expect(screen.getByLabelText(t('ar', 'staffLogin.confirmPin'))).not.toBeNull();
});
it('refuses a mismatched or malformed new PIN before it ever reaches the server', async () => {
  calls.signIn.mockResolvedValue({ kind: 'change_required', proof });
  display();
  submit();
  await screen.findByRole('heading', { name: t('ar', 'staffLogin.changePinTitle') });
  typeNewPin('5678', '1234');
  saveNewPin();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(t('ar', 'staffLogin.pinMismatch')),
  );
  expect(calls.changePin).not.toHaveBeenCalled();
  typeNewPin('12', '12');
  saveNewPin();
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(t('ar', 'staffLogin.pinFormatInvalid')),
  );
  expect(calls.changePin).not.toHaveBeenCalled();
});
it('never posts a new PIN while the device is offline', async () => {
  calls.signIn.mockResolvedValue({ kind: 'change_required', proof });
  display();
  submit();
  await screen.findByRole('heading', { name: t('ar', 'staffLogin.changePinTitle') });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  typeNewPin('5678', '5678');
  saveNewPin();
  await Promise.resolve();
  expect(calls.changePin).not.toHaveBeenCalled();
});
it('saves the new PIN once and forgets both the PIN and the proof', async () => {
  calls.signIn.mockResolvedValue({ kind: 'change_required', proof });
  calls.changePin.mockResolvedValue('changed');
  const cache = new QueryClient();
  render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <PinForm onSignedIn={vi.fn()} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  submit();
  await screen.findByRole('heading', { name: t('ar', 'staffLogin.changePinTitle') });
  typeNewPin('5678', '5678');
  saveNewPin();
  await waitFor(() => expect(calls.changePin).toHaveBeenCalledWith({ proof, pin: '5678' }));
  expect((await screen.findByText(t('ar', 'staffLogin.pinChangedSignIn'))).textContent).toBe(
    t('ar', 'staffLogin.pinChangedSignIn'),
  );
  expect(screen.queryByLabelText(t('ar', 'staffLogin.newPin'))).toBeNull();
  expect((screen.getByLabelText(t('ar', 'staffLogin.ownPin')) as HTMLInputElement).value).toBe('');
  for (const store of [localStorage, sessionStorage]) {
    expect(storageDump(store)).not.toContain('5678');
    expect(storageDump(store)).not.toContain(proof);
  }
  expect(JSON.stringify(cache.getQueryCache().getAll())).not.toContain('5678');
  expect(JSON.stringify(cache.getQueryCache().getAll())).not.toContain(proof);
  expect(document.body.textContent).not.toContain(proof);
});
it('tells the cashier the temporary PIN ran out, from the sign-in and from the change', async () => {
  calls.signIn.mockResolvedValue({ kind: 'expired' });
  display();
  submit();
  expect((await screen.findByRole('alert')).textContent).toBe(t('ar', 'staffLogin.pinExpired'));
});
it('tells the cashier the temporary PIN ran out when the change comes back expired', async () => {
  calls.signIn.mockResolvedValue({ kind: 'change_required', proof });
  calls.changePin.mockResolvedValue('expired');
  display();
  submit();
  await screen.findByRole('heading', { name: t('ar', 'staffLogin.changePinTitle') });
  typeNewPin('5678', '5678');
  saveNewPin();
  expect((await screen.findByRole('alert')).textContent).toBe(t('ar', 'staffLogin.pinExpired'));
  expect(screen.queryByLabelText(t('ar', 'staffLogin.newPin'))).toBeNull();
});
