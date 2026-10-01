import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { LoginPage } from '../pages/login-page';
import { LoginForm } from './login-form';

const mockPush = vi.fn();
const mockSignInWithPassword = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

vi.mock('../api/session-calls', () => ({
  signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
}));

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        {ui}
      </LocaleProvider>
    </DirectionProvider>,
  );
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows validation errors and does not call onSubmit on empty or invalid input', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<LoginForm pending={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.signInSubmit') }));

    await waitFor(() => {
      expect(screen.getByText(t('ar', 'admin.emailInvalid'))).not.toBeNull();
      expect(screen.getByText(t('ar', 'admin.passwordRequired'))).not.toBeNull();
    });

    expect(onSubmit).not.toHaveBeenCalled();

    const emailInput = screen.getByLabelText(t('ar', 'admin.emailLabel'));
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.signInSubmit') }));

    await waitFor(() => {
      expect(screen.getByText(t('ar', 'admin.emailInvalid'))).not.toBeNull();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit once when valid credentials are submitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<LoginForm pending={false} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(t('ar', 'admin.emailLabel')), {
      target: { value: 'admin@pospay.systems' },
    });
    fireEvent.change(screen.getByLabelText(t('ar', 'admin.passwordLabel')), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.signInSubmit') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      email: 'admin@pospay.systems',
      password: 'correct-horse-battery',
    });
  });

  it('navigates to /login/two-factor when sign-in requires TOTP', async () => {
    mockSignInWithPassword.mockResolvedValueOnce('totp');
    renderWithProviders(<LoginPage />);

    fireEvent.change(screen.getByLabelText(t('ar', 'admin.emailLabel')), {
      target: { value: 'admin@pospay.systems' },
    });
    fireEvent.change(screen.getByLabelText(t('ar', 'admin.passwordLabel')), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.signInSubmit') }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login/two-factor');
    });
  });
});
