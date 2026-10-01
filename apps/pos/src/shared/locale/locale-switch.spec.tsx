import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it } from 'vitest';

import { DocumentShell } from './document-shell';
import { LocaleSwitch } from './locale-switch';

describe('LocaleSwitch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'ar';
  });

  it('flips dir between rtl and ltr and persists the choice to localStorage', () => {
    render(
      <DocumentShell>
        <LocaleSwitch />
      </DocumentShell>,
    );

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');

    const switchButton = screen.getByRole('button', {
      name: t('ar', 'pos.languageEnglish'),
    });
    fireEvent.click(switchButton);

    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
    expect(localStorage.getItem('pospay.locale')).toBe('en');

    const switchBack = screen.getByRole('button', {
      name: t('en', 'pos.languageArabic'),
    });
    fireEvent.click(switchBack);

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('pospay.locale')).toBe('ar');
  });
});
