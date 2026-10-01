import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentShell } from './document-shell';
import { LocaleSwitch } from './locale-switch';

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

describe('LocaleSwitch', () => {
  beforeEach(() => {
    mockRefresh.mockClear();
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });

  it('flips dir between rtl and ltr and refreshes the router', () => {
    render(
      <DocumentShell locale="ar">
        <LocaleSwitch />
      </DocumentShell>,
    );

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');

    const switchButton = screen.getByRole('button', {
      name: t('ar', 'admin.languageEnglish'),
    });
    fireEvent.click(switchButton);

    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(mockRefresh).toHaveBeenCalledOnce();

    const switchBack = screen.getByRole('button', {
      name: t('en', 'admin.languageArabic'),
    });
    fireEvent.click(switchBack);

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});
