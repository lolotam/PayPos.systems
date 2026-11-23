import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import type { SetPasswordOutcome } from '../api/set-password-calls';
import { SetPasswordPage } from './set-password-page';

const mockPush = vi.fn();
const mockSetPasswordCall = vi.fn();
// useSearchParams Ø¨ØªØ§Ø¹ Next Ù…Ø§ Ø¨ØªØ´ÙˆÙØ´ replaceState Ø§Ù„Ù…Ø¨Ø§Ø´Ø±Ø› Ø§Ù„Ù‚ÙŠÙ…Ø© Ø¨ØªØªØºÙŠØ± Ù…Ø¹ Ø§Ù„ØªÙ†Ù‚Ù„ Ø¨Ø³.
const navState = { search: '' };

function goto(url: string) {
  window.history.replaceState(null, '', url);
  navState.search = url.split('?')[1] ?? '';
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navState.search),
}));

vi.mock('../api/set-password-calls', () => ({
  setPassword: (...args: unknown[]) => mockSetPasswordCall(...args),
}));

function renderSetPasswordPage() {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <SetPasswordPage />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

function fillBothPasswords(value: string) {
  fireEvent.change(screen.getByLabelText(t('ar', 'admin.newPasswordLabel')), {
    target: { value },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'admin.confirmPasswordLabel')), {
    target: { value },
  });
}

function submitButton() {
  return screen.getByRole('button', { name: t('ar', 'admin.setPasswordSubmit') });
}

beforeEach(() => {
  vi.clearAllMocks();
  goto('/');
});

it('shows the expired-link state with no form when the URL carries no token', async () => {
  goto('/set-password');
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordInvalidLinkTitle'))).not.toBeNull();
  });
  expect(screen.queryByLabelText(t('ar', 'admin.newPasswordLabel'))).toBeNull();
  expect(screen.queryByLabelText(t('ar', 'admin.confirmPasswordLabel'))).toBeNull();
  expect(mockSetPasswordCall).not.toHaveBeenCalled();
});

it('shows the expired-link state when the URL carries an error parameter', async () => {
  goto('/set-password?error=INVALID_TOKEN');
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordInvalidLinkTitle'))).not.toBeNull();
  });
  expect(screen.queryByLabelText(t('ar', 'admin.newPasswordLabel'))).toBeNull();
  expect(mockSetPasswordCall).not.toHaveBeenCalled();
});

it('shows the form for a token link and strips the token from the address bar', async () => {
  goto('/set-password?token=one-time-token');
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByLabelText(t('ar', 'admin.newPasswordLabel'))).not.toBeNull();
  });
  expect(window.location.pathname).toBe('/set-password');
  expect(window.location.search).toBe('');
});

it('calls the client once with the token and shows the success state with a button to /login', async () => {
  goto('/set-password?token=one-time-token');
  mockSetPasswordCall.mockResolvedValue('done');
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByLabelText(t('ar', 'admin.newPasswordLabel'))).not.toBeNull();
  });
  fillBothPasswords('correct-horse');
  fireEvent.click(submitButton());

  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordDoneTitle'))).not.toBeNull();
  });
  expect(mockSetPasswordCall).toHaveBeenCalledTimes(1);
  expect(mockSetPasswordCall).toHaveBeenCalledWith('one-time-token', 'correct-horse');
  expect(screen.getByRole('button', { name: t('ar', 'admin.goToLogin') })).not.toBeNull();
  expect(screen.queryByLabelText(t('ar', 'admin.newPasswordLabel'))).toBeNull();
});

it('disables the submit button while the request is pending', async () => {
  goto('/set-password?token=one-time-token');
  let resolve!: (outcome: SetPasswordOutcome) => void;
  mockSetPasswordCall.mockImplementation(
    () =>
      new Promise<SetPasswordOutcome>((res) => {
        resolve = res;
      }),
  );
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByLabelText(t('ar', 'admin.newPasswordLabel'))).not.toBeNull();
  });
  fillBothPasswords('correct-horse');
  fireEvent.click(submitButton());

  await waitFor(() => {
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
  });
  resolve('done');
  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordDoneTitle'))).not.toBeNull();
  });
});

it('shows the mismatch message inline and sends no request', async () => {
  goto('/set-password?token=one-time-token');
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByLabelText(t('ar', 'admin.newPasswordLabel'))).not.toBeNull();
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'admin.newPasswordLabel')), {
    target: { value: 'correct-horse' },
  });
  fireEvent.change(screen.getByLabelText(t('ar', 'admin.confirmPasswordLabel')), {
    target: { value: 'different-one' },
  });
  fireEvent.click(submitButton());

  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordMismatch'))).not.toBeNull();
  });
  expect(mockSetPasswordCall).not.toHaveBeenCalled();
});

it('shows the length message for a too-short password and sends no request', async () => {
  goto('/set-password?token=one-time-token');
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByLabelText(t('ar', 'admin.newPasswordLabel'))).not.toBeNull();
  });
  fillBothPasswords('short7');
  fireEvent.click(submitButton());

  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordLength'))).not.toBeNull();
  });
  expect(mockSetPasswordCall).not.toHaveBeenCalled();
});

it('shows the expired-link state when the API rejects the token as invalid', async () => {
  goto('/set-password?token=one-time-token');
  mockSetPasswordCall.mockResolvedValue('invalid-link');
  renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByLabelText(t('ar', 'admin.newPasswordLabel'))).not.toBeNull();
  });
  fillBothPasswords('correct-horse');
  fireEvent.click(submitButton());

  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordInvalidLinkTitle'))).not.toBeNull();
  });
  expect(screen.queryByLabelText(t('ar', 'admin.newPasswordLabel'))).toBeNull();
  expect(screen.queryByRole('button', { name: t('ar', 'admin.goToLogin') })).toBeNull();
});

it('renders right-to-left with the Arabic strings in the Arabic locale', async () => {
  goto('/set-password?token=one-time-token');
  const { container } = renderSetPasswordPage();

  await waitFor(() => {
    expect(screen.getByText(t('ar', 'admin.setPasswordTitle'))).not.toBeNull();
  });
  expect((container.firstElementChild as HTMLElement).getAttribute('dir')).toBe('rtl');
  expect(screen.getByText(t('ar', 'admin.setPasswordLead'))).not.toBeNull();
  expect(screen.getByLabelText(t('ar', 'admin.newPasswordLabel'))).not.toBeNull();
  expect(screen.getByLabelText(t('ar', 'admin.confirmPasswordLabel'))).not.toBeNull();
});
