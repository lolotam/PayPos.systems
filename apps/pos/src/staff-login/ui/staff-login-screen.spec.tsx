import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { StaffLoginScreen } from './staff-login-screen';
const calls = vi.hoisted(() => ({ changed: vi.fn(), signOut: vi.fn() }));
vi.mock('../api/use-staff-login', () => ({
  useStaffLogin: () => ({
    online: true,
    loading: false,
    epoch: 0,
    session: { expires_at: 'synthetic' },
    ...calls,
  }),
}));
vi.mock('./otp-form', () => ({
  OtpForm: ({ onSignedIn }: { onSignedIn: () => void }) => (
    <button onClick={onSignedIn}>synthetic proof</button>
  ),
}));
afterEach(() => {
  vi.clearAllMocks();
});
it('changing operator preserves the old server session until new proof, and cancellation keeps it', () => {
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <StaffLoginScreen />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.switchOperator') }));
  expect(calls.signOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.cancelSwitch') }));
  expect(screen.getByRole('heading').textContent).toBe(t('ar', 'staffLogin.signedIn'));
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.switchOperator') }));
  fireEvent.click(screen.getByRole('button', { name: 'synthetic proof' }));
  expect(calls.changed).toHaveBeenCalledOnce();
  expect(calls.signOut).not.toHaveBeenCalled();
});
