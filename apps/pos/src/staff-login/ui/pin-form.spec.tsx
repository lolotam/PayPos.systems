import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { PinForm } from './pin-form';

const calls = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock('../api/staff-calls', () => ({ signInStaffPin: calls.signIn }));
const value = String(10).padStart(4, '0');
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
