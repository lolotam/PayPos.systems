import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { LoginForm } from './login-form';
import { PasswordConfirmForm } from './password-confirm-form';
import { SetPasswordForm } from './set-password-form';
import { TotpForm } from './totp-form';

interface FormCase {
  name: string;
  element: (pending: boolean, onSubmit: Mock) => ReactElement;
  submitLabel: MessageKey;
  fields: Array<{ label: MessageKey; value: string }>;
  submitted: unknown;
}

const cases: FormCase[] = [
  {
    name: 'LoginForm',
    element: (pending, onSubmit) => <LoginForm pending={pending} onSubmit={onSubmit} />,
    submitLabel: 'admin.signInSubmit',
    fields: [
      { label: 'admin.emailLabel', value: 'admin@pospay.systems' },
      { label: 'admin.passwordLabel', value: 'correct-horse-battery' },
    ],
    submitted: { email: 'admin@pospay.systems', password: 'correct-horse-battery' },
  },
  {
    name: 'TotpForm',
    element: (pending, onSubmit) => <TotpForm pending={pending} onSubmit={onSubmit} />,
    submitLabel: 'admin.verifySubmit',
    fields: [{ label: 'admin.codeLabel', value: '654321' }],
    submitted: { code: '654321' },
  },
  {
    name: 'PasswordConfirmForm',
    element: (pending, onSubmit) => <PasswordConfirmForm pending={pending} onSubmit={onSubmit} />,
    submitLabel: 'admin.enrolContinue',
    fields: [{ label: 'admin.passwordLabel', value: 'correct-horse-battery' }],
    submitted: { password: 'correct-horse-battery' },
  },
  {
    name: 'SetPasswordForm',
    element: (pending, onSubmit) => <SetPasswordForm pending={pending} onSubmit={onSubmit} />,
    submitLabel: 'admin.setPasswordSubmit',
    fields: [
      { label: 'admin.newPasswordLabel', value: 'correct-horse-battery' },
      { label: 'admin.confirmPasswordLabel', value: 'correct-horse-battery' },
    ],
    submitted: 'correct-horse-battery',
  },
];

function renderWithProviders(ui: ReactElement) {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        {ui}
      </LocaleProvider>
    </DirectionProvider>,
  );
}

function submitButton(c: FormCase): HTMLButtonElement {
  return screen.getByRole('button', { name: t('ar', c.submitLabel) }) as HTMLButtonElement;
}

describe.each(cases)('$name posts natively', (c: FormCase) => {
  it('renders a form element with method="post"', () => {
    renderWithProviders(c.element(false, vi.fn()));

    const form = document.querySelector('form');
    expect(form).not.toBeNull();
    expect(form?.method).toBe('post');
  });

  it('enables the submit button once hydrated while pending is false', () => {
    renderWithProviders(c.element(false, vi.fn()));

    expect(submitButton(c).disabled).toBe(false);
  });

  it('disables the submit button while pending is true', () => {
    renderWithProviders(c.element(true, vi.fn()));

    expect(submitButton(c).disabled).toBe(true);
  });

  it('server-renders the form with method="post" and a disabled submit button', () => {
    const markup = renderToString(
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        {c.element(false, vi.fn())}
      </LocaleProvider>,
    );

    expect(markup).toContain('method="post"');
    expect(markup).toMatch(/<button[^>]*\sdisabled/);
  });

  it('submits the filled values through the hydrated form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(c.element(false, onSubmit));

    for (const field of c.fields) {
      fireEvent.change(screen.getByLabelText(t('ar', field.label)), {
        target: { value: field.value },
      });
    }
    fireEvent.click(submitButton(c));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toEqual(c.submitted);
  });
});
