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
    session: { expires_at: '2026-10-02T10:08:00Z', branch_id: 'synthetic-branch' },
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
  expect(screen.getByRole('heading', { name: t('ar', 'staffLogin.signedIn') })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.switchOperator') }));
  fireEvent.click(screen.getByRole('button', { name: 'synthetic proof' }));
  expect(calls.changed).toHaveBeenCalledOnce();
  expect(calls.signOut).not.toHaveBeenCalled();
});

it('shows operator controls and a localized remaining duration after sign-in', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
  try {
    render(
      <LocaleProvider locale="en" setLocale={() => undefined}>
        <StaffLoginScreen />
      </LocaleProvider>,
    );
    expect(screen.getByRole('heading', { name: t('en', 'staffLogin.signedIn') })).toBeDefined();
    expect(screen.getByText('Session ends in 8 minutes')).toBeDefined();
    expect(screen.getByRole('button', { name: t('en', 'staffLogin.signOut') })).toBeDefined();
    expect(
      screen.getByRole('button', { name: t('en', 'staffLogin.switchOperator') }),
    ).toBeDefined();
    expect(screen.queryByText('2026-10-02T10:08:00Z')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
