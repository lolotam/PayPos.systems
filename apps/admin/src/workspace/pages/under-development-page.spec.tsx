import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UnderDevelopmentPage } from './under-development-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

describe.each(['en', 'ar'] as const)('Under development in %s', (locale) => {
  const name = t(locale, 'adminNavPages.kitchenScreens');
  it('shows the entry name, one line and a way back to Home, with no date or phase', () => {
    state.locale = locale;
    render(<UnderDevelopmentPage name={name} homeHref="/" />);
    expect(screen.getByRole('heading', { name })).toBeTruthy();
    expect(screen.getByText(t(locale, 'adminNav.underDevBody'))).toBeTruthy();
    const back = screen.getByRole('link', { name: t(locale, 'adminNav.underDevBackHome') });
    expect(back.getAttribute('href')).toBe('/');
    expect(document.body.textContent).not.toMatch(/phase|مرحلة|20\d\d/i);
  });
});
