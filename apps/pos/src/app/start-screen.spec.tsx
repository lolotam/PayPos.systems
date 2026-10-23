import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { StartScreen } from './start-screen';

function mount(locale: 'ar' | 'en') {
  const onChoose = vi.fn();
  render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <StartScreen onChoose={onChoose} />
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

  it('reports the counter choice to the caller', () => {
    const onChoose = mount('ar');

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.counter') }));

    expect(onChoose).toHaveBeenCalledWith('counter');
  });

  it('reports the employee choice to the caller', () => {
    const onChoose = mount('ar');

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.employee') }));

    expect(onChoose).toHaveBeenCalledWith('employee');
  });

  it('shows the English titles and hints in English', () => {
    mount('en');

    expect(screen.getByRole('heading', { name: t('en', 'nativeShell.title') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('en', 'nativeShell.counter') })).not.toBeNull();
    expect(screen.getByRole('button', { name: t('en', 'nativeShell.employee') })).not.toBeNull();
    expect(screen.getByText(t('en', 'nativeShell.counterHint'))).not.toBeNull();
    expect(screen.getByText(t('en', 'nativeShell.employeeHint'))).not.toBeNull();
  });
});
