import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { StartScreen } from './start-screen';

const CHOICE_KEYS = {
  counter: 'nativeShell.counter',
  employee: 'nativeShell.employee',
} as const;

const ALERT_KEYS = {
  saveFailed: 'nativeShell.saveFailed',
  needsInternet: 'nativeShell.needsInternet',
  linkRequired: 'personalStaff.linkRequired',
} as const;

function mount(locale: 'ar' | 'en', options: { alert?: keyof typeof ALERT_KEYS } = {}) {
  const onChoose = vi.fn();
  render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <StartScreen onChoose={onChoose} {...options} />
      </LocaleProvider>
    </DirectionProvider>,
  );
  return onChoose;
}

describe('StartScreen', () => {
  it('shows both choices with their hints and the first-connection line', () => {
    mount('ar');

    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.counter') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.employee') })).not.toBeNull();
    expect(screen.getByText(t('ar', 'nativeShell.counterHint'))).not.toBeNull();
    expect(screen.getByText(t('ar', 'nativeShell.employeeHint'))).not.toBeNull();
    expect(screen.getByText(t('ar', 'nativeShell.needsInternet'))).not.toBeNull();
  });

  it.each(['counter', 'employee'] as const)('reports the %s choice to the caller', (role) => {
    const onChoose = mount('ar');

    const button = screen.getByRole('button', { name: t('ar', CHOICE_KEYS[role]) });
    expect(button.hasAttribute('disabled')).toBe(false);

    fireEvent.click(button);

    expect(onChoose).toHaveBeenCalledWith(role);
  });

  it('shows the English titles and hints in English', () => {
    mount('en');

    expect(screen.getByRole('heading', { name: t('en', 'nativeShell.title') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('en', 'nativeShell.counter') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('en', 'nativeShell.employee') })).not.toBeNull();
    expect(screen.getByText(t('en', 'nativeShell.counterHint'))).not.toBeNull();
    expect(screen.getByText(t('en', 'nativeShell.employeeHint'))).not.toBeNull();
  });

  it.each(['saveFailed', 'needsInternet', 'linkRequired'] as const)(
    'shows the %s warning inside the alert',
    (kind) => {
      mount('ar', { alert: kind });

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain(t('ar', ALERT_KEYS[kind]));
      expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
    },
  );

  it('puts the two choices side by side in landscape', () => {
    mount('ar');

    const counter = screen.getByRole('button', { name: t('ar', 'nativeShell.counter') });
    const employee = screen.getByRole('button', { name: t('ar', 'nativeShell.employee') });
    const choices = counter.parentElement?.parentElement;

    expect(choices).toBe(employee.parentElement?.parentElement);
    expect(choices?.className).toContain('landscape:grid-cols-2');
    expect(choices?.contains(employee)).toBe(true);
    expect(choices?.parentElement?.className).toContain('landscape:max-w-3xl');
  });

  it('shows no warning by default', () => {
    mount('ar');

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
  });
});
