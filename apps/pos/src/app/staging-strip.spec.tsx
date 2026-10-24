import { cleanup, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { isStagingApp } from '@/shared/platform/native-shell';

import { StagingStrip } from './staging-strip';

vi.mock('@/shared/platform/native-shell', () => ({
  isStagingApp: vi.fn(),
}));

function mount(locale: 'ar' | 'en') {
  return render(
    <LocaleProvider locale={locale} setLocale={() => undefined}>
      <StagingStrip />
    </LocaleProvider>,
  );
}

describe('StagingStrip', () => {
  beforeEach(() => {
    vi.mocked(isStagingApp).mockReturnValue(false);
  });

  it('shows the strip in Arabic and in English on the staging app', () => {
    vi.mocked(isStagingApp).mockReturnValue(true);

    mount('ar');
    expect(screen.getByRole('note').textContent).toBe(t('ar', 'nativeShell.stagingStrip'));

    cleanup();
    mount('en');
    expect(screen.getByRole('note').textContent).toBe(t('en', 'nativeShell.stagingStrip'));
    expect(t('en', 'nativeShell.stagingStrip')).toBe('Test version');
  });

  it('shows no strip in the production app', () => {
    vi.mocked(isStagingApp).mockReturnValue(false);

    mount('ar');

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows no strip in the web app', () => {
    vi.mocked(isStagingApp).mockReturnValue(false);

    const { container } = mount('ar');

    expect(screen.queryByRole('note')).toBeNull();
    expect(container.textContent).toBe('');
  });
});
