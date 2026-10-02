import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { OtpForm } from './otp-form';

const calls = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }));
vi.mock('../api/staff-calls', () => ({
  requestStaffCode: calls.request,
  verifyStaffCode: calls.verify,
}));
const id = '01920000-0000-7000-8000-000000000001';
const acknowledgement = {
  status: 'ACCEPTED',
  challenge_id: id,
  expires_in: 300,
  retry_after: 60,
  recovery: 'ASK_MANAGER',
};
const display = (done = vi.fn()) =>
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <OtpForm onSignedIn={done} />
    </LocaleProvider>,
  );
const submitPhone = () => {
  fireEvent.change(screen.getByLabelText(t('ar', 'staffLogin.phone')), {
    target: { value: '+99900000001' },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'staffLogin.language')), {
    target: { value: 'ar' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.request') }));
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  calls.request.mockResolvedValue({ kind: 'accepted', acknowledgement });
  calls.verify.mockResolvedValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('volatile paired-device OTP form', () => {
  it('requires an explicit locale, then replaces phone entry with code and common recovery', async () => {
    display();
    expect((screen.getByLabelText(t('ar', 'staffLogin.language')) as HTMLSelectElement).value).toBe(
      '',
    );
    submitPhone();
    await screen.findByLabelText(t('ar', 'staffLogin.code'));
    expect(screen.queryByLabelText(t('ar', 'staffLogin.phone'))).toBeNull();
    expect(screen.getByText(t('ar', 'staffLogin.recovery'))).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: t('ar', 'staffLogin.newCode') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(localStorage.getItem('staff-phone')).toBeNull();
  });
  it('a wrong or missing code has only the generic translated error', async () => {
    display();
    submitPhone();
    const input = await screen.findByLabelText(t('ar', 'staffLogin.code'));
    fireEvent.change(input, { target: { value: String(7).padStart(6, '0') } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.verify') }));
    expect((await screen.findByRole('alert')).textContent).toBe(t('ar', 'errors.OTP_INVALID'));
    expect(calls.verify).toHaveBeenCalledWith({
      challenge_id: id,
      code: String(7).padStart(6, '0'),
    });
  });
  it('success wipes credential form state and offline completion cannot authenticate', async () => {
    const done = vi.fn();
    calls.verify.mockResolvedValue({ user_id: 'synthetic' });
    display(done);
    submitPhone();
    const input = await screen.findByLabelText(t('ar', 'staffLogin.code'));
    fireEvent.change(input, { target: { value: String(7).padStart(6, '0') } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.verify') }));
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText(t('ar', 'staffLogin.code'))).toBeNull();
    expect((screen.getByLabelText(t('ar', 'staffLogin.phone')) as HTMLInputElement).value).toBe('');
  });
});

describe('request outcomes share the same recovery guidance', () => {
  it.each(['eligible', 'unknown', 'nonmember', 'suppressed', 'enqueue-failure'])(
    '%s is indistinguishable after acceptance',
    async () => {
      display();
      submitPhone();
      await screen.findByLabelText(t('ar', 'staffLogin.code'));
      expect(screen.getByText(t('ar', 'staffLogin.recovery'))).not.toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );
  it('disabled/unavailable shows the same manager and own-PIN guidance', async () => {
    calls.request.mockResolvedValue({ kind: 'refused', code: 'OTP_UNAVAILABLE' });
    display();
    submitPhone();
    expect(await screen.findByText(t('ar', 'errors.OTP_UNAVAILABLE'))).not.toBeNull();
    expect(screen.getByText(t('ar', 'staffLogin.recovery'))).not.toBeNull();
  });
  it('does not submit request while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    display();
    submitPhone();
    await waitFor(() => expect(calls.request).not.toHaveBeenCalled());
  });
});
describe('in-flight authentication never completes offline', () => {
  it('discards a request response that arrives after connectivity is lost', async () => {
    let finish: () => void = () => undefined;
    calls.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: 'accepted', acknowledgement });
        }),
    );
    display();
    submitPhone();
    await waitFor(() => expect(calls.request).toHaveBeenCalledOnce());
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    finish();
    await waitFor(() => expect(screen.queryByLabelText(t('ar', 'staffLogin.code'))).toBeNull());
    expect(localStorage.getItem('staff-phone')).toBeNull();
  });
  it('does not authenticate from a verification response received offline', async () => {
    let finish: () => void = () => undefined;
    calls.verify.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ user_id: 'synthetic' });
        }),
    );
    const done = vi.fn();
    display(done);
    submitPhone();
    fireEvent.change(await screen.findByLabelText(t('ar', 'staffLogin.code')), {
      target: { value: String(7).padStart(6, '0') },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'staffLogin.verify') }));
    await waitFor(() => expect(calls.verify).toHaveBeenCalledOnce());
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    finish();
    await screen.findByRole('alert');
    expect(done).not.toHaveBeenCalled();
  });
});
