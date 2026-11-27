import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { LoginPage } from '../pages/login-page';

const mockRequest = vi.fn();
const mockReset = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../api/session-calls', () => ({ signInWithPassword: vi.fn() }));
vi.mock('../api/password-reset-calls', () => ({
  requestPasswordResetCode: (...args: unknown[]) => mockRequest(...args),
  resetPasswordWithCode: (...args: unknown[]) => mockReset(...args),
}));

const ar = (key: Parameters<typeof t>[1]) => t('ar', key);
const waitingName = new RegExp(ar('passwordReset.resendWait').split('{seconds}')[0] ?? '');

function renderLogin() {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <LoginPage />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

const accepted = { kind: 'accepted', challengeId: 'synthetic-challenge', retryAfter: 60 };

async function openRequestStep() {
  renderLogin();
  fireEvent.click(await screen.findByRole('button', { name: ar('passwordReset.link') }));
  return screen.findByText(ar('passwordReset.requestTitle'));
}

async function reachVerifyStep() {
  await openRequestStep();
  fireEvent.change(screen.getByLabelText(ar('admin.emailLabel')), {
    target: { value: 'Owner@Example.Invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: ar('passwordReset.requestSubmit') }));
  await screen.findByText(ar('passwordReset.verifyTitle'));
}

function fillVerify(code: string, password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText(ar('passwordReset.codeLabel')), {
    target: { value: code },
  });
  fireEvent.change(screen.getByLabelText(ar('admin.newPasswordLabel')), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText(ar('admin.confirmPasswordLabel')), {
    target: { value: confirm },
  });
  fireEvent.click(screen.getByRole('button', { name: ar('passwordReset.resetSubmit') }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequest.mockResolvedValue(accepted);
  mockReset.mockResolvedValue({ kind: 'done' });
});

describe('forgot password entry', () => {
  it('shows the forgot-password link on sign-in and opens the request step in the same frame', async () => {
    renderLogin();
    expect(screen.getByRole('button', { name: ar('passwordReset.link') })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ar('passwordReset.link') }));
    expect(await screen.findByText(ar('passwordReset.requestTitle'))).not.toBeNull();
    expect(screen.getByText(ar('passwordReset.requestLead'))).not.toBeNull();
    expect(screen.queryByLabelText(ar('admin.passwordLabel'))).toBeNull();
  });

  it('returns to sign-in from the request step', async () => {
    await openRequestStep();
    fireEvent.click(screen.getByRole('button', { name: ar('passwordReset.backToSignIn') }));
    expect(await screen.findByText(ar('admin.signInTitle'))).not.toBeNull();
  });
});

describe('step 1 — request the code', () => {
  it('refuses an invalid email without calling the API', async () => {
    await openRequestStep();
    fireEvent.change(screen.getByLabelText(ar('admin.emailLabel')), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: ar('passwordReset.requestSubmit') }));
    expect(await screen.findByText(ar('admin.emailInvalid'))).not.toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('sends the lower-cased email with the page language and moves to the code step', async () => {
    await reachVerifyStep();
    expect(mockRequest).toHaveBeenCalledWith('owner@example.invalid', 'ar');
    // الرسالة موحّدة: ما بتقولش لو الإيميل ليه حساب.
    expect(screen.getByText(ar('passwordReset.verifyLead'))).not.toBeNull();
  });

  it.each([
    ['passwordReset.tooMany'],
    ['passwordReset.unavailable'],
    ['admin.unexpected'],
  ] as const)('shows %s as an alert and stays on the request step', async (key) => {
    mockRequest.mockResolvedValue({ kind: 'error', key });
    await openRequestStep();
    fireEvent.change(screen.getByLabelText(ar('admin.emailLabel')), {
      target: { value: 'owner@example.invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: ar('passwordReset.requestSubmit') }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ar(key));
    expect(screen.getByText(ar('passwordReset.requestTitle'))).not.toBeNull();
  });
});

describe('step 2 — code and new password', () => {
  it('counts the resend delay down, then allows a new code and restarts the delay', async () => {
    mockRequest.mockResolvedValue({ ...accepted, retryAfter: 1 });
    await reachVerifyStep();
    const waiting = await screen.findByRole('button', { name: waitingName });
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
    expect(waiting.textContent).toContain('1');
    const resend = await screen.findByRole(
      'button',
      { name: ar('passwordReset.resend') },
      { timeout: 3000 },
    );
    expect((resend as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(resend);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    expect(mockRequest).toHaveBeenLastCalledWith('owner@example.invalid', 'ar');
    expect(await screen.findByRole('button', { name: waitingName })).not.toBeNull();
  });

  it('shows the whole countdown sentence with the seconds inside it', async () => {
    mockRequest.mockResolvedValue({ ...accepted, retryAfter: 7 });
    await reachVerifyStep();
    const waiting = await screen.findByRole('button', { name: waitingName });
    expect(waiting.textContent).toBe(ar('passwordReset.resendWait').replace('{seconds}', '7'));
  });

  it('takes the Retry-After of a too-many-requests answer as the new countdown', async () => {
    mockRequest.mockResolvedValueOnce({ ...accepted, retryAfter: 1 });
    await reachVerifyStep();
    const resend = await screen.findByRole(
      'button',
      { name: ar('passwordReset.resend') },
      { timeout: 3000 },
    );
    mockRequest.mockResolvedValueOnce({
      kind: 'error',
      key: 'passwordReset.tooMany',
      retryAfter: 30,
    });
    fireEvent.click(resend);
    const waiting = await screen.findByRole('button', { name: waitingName });
    expect(waiting.textContent).toContain('30');
    expect((waiting as HTMLButtonElement).disabled).toBe(true);
  });

  it('refuses a short code, a short password and a mismatch with field messages and no API call', async () => {
    await reachVerifyStep();
    fillVerify('12345', 'short', 'other');
    expect(await screen.findByText(ar('passwordReset.codeInvalid'))).not.toBeNull();
    expect(screen.getByText(ar('admin.setPasswordLength'))).not.toBeNull();
    expect(mockReset).not.toHaveBeenCalled();
    fillVerify('123456', 'a-new-password', 'a-different-one');
    expect(await screen.findByText(ar('admin.setPasswordMismatch'))).not.toBeNull();
    expect(mockReset).not.toHaveBeenCalled();
  });
});

describe('step 2 — server answers', () => {
  it('shows the wrong-code message and keeps the form so the visitor can retry', async () => {
    mockReset.mockResolvedValue({ kind: 'error', key: 'passwordReset.invalidCode' });
    await reachVerifyStep();
    fillVerify('123456', 'a-new-password', 'a-new-password');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ar('passwordReset.invalidCode'));
    expect(screen.getByLabelText(ar('passwordReset.codeLabel'))).not.toBeNull();
  });

  it('shows the done step after a reset and sends the visitor back to sign-in', async () => {
    await reachVerifyStep();
    fillVerify('123456', 'a-new-password', 'a-new-password');
    expect(await screen.findByText(ar('passwordReset.doneTitle'))).not.toBeNull();
    expect(mockReset).toHaveBeenCalledWith({
      challengeId: 'synthetic-challenge',
      code: '123456',
      newPassword: 'a-new-password',
    });
    fireEvent.click(screen.getByRole('button', { name: ar('admin.goToLogin') }));
    expect(await screen.findByText(ar('admin.signInTitle'))).not.toBeNull();
    expect(screen.getByLabelText(ar('admin.passwordLabel'))).not.toBeNull();
  });

  it('disables the controls while a request is in flight', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockReset.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await reachVerifyStep();
    fillVerify('123456', 'a-new-password', 'a-new-password');
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: ar('passwordReset.resetSubmit') }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
    await act(async () => finish({ kind: 'done' }));
    expect(await screen.findByText(ar('passwordReset.doneTitle'))).not.toBeNull();
  });
});
