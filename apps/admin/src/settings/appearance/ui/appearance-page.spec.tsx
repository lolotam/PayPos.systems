import { t } from '@pospay/i18n';
import { DirectionProvider, readThemePreference, setThemePreference } from '@pospay/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppearancePage } from './appearance-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const NAMES = {
  A: 'adminNav.styleALabel',
  B: 'adminNav.styleBLabel',
  C: 'adminNav.styleCLabel',
} as const;

function renderPage(style: 'A' | 'B' | 'C', onChoose = vi.fn()) {
  render(
    <DirectionProvider dir={state.locale === 'ar' ? 'rtl' : 'ltr'}>
      <AppearancePage style={style} onChoose={onChoose} />
    </DirectionProvider>,
  );
  return onChoose;
}

const cardOf = (locale: 'en' | 'ar', style: 'A' | 'B' | 'C') =>
  screen.getByRole('heading', { name: t(locale, NAMES[style]) }).closest('[aria-current], div');

beforeEach(() => {
  state.locale = 'en';
  setThemePreference('system');
});

describe.each(['en', 'ar'] as const)('Appearance in %s', (locale) => {
  it('lists the three styles by name and marks the current one in words', () => {
    state.locale = locale;
    renderPage('C');
    for (const key of Object.values(NAMES)) {
      expect(screen.getByRole('heading', { name: t(locale, key) })).toBeTruthy();
    }
    const current = screen
      .getByRole('heading', { name: t(locale, NAMES.C) })
      .closest('[aria-current]');
    expect(current?.textContent).toContain(t(locale, 'adminNav.currentStyleBadge'));
    expect(within(current as HTMLElement).queryByRole('button')).toBeNull();
    const choices = screen.getAllByRole('button', {
      name: new RegExp(t(locale, 'adminNav.chooseStyleAction')),
    });
    expect(choices).toHaveLength(2);
  });
});

describe('Appearance choices', () => {
  it('calls the setter with the style of the card that was chosen', () => {
    const onChoose = renderPage('C');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('en', NAMES.A)) }));
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('A');
  });

  it('puts the current mark on the style that is in use', () => {
    renderPage('B');
    const current = screen
      .getByRole('heading', { name: t('en', NAMES.B) })
      .closest('[aria-current]');
    expect(current?.textContent).toContain(t('en', 'adminNav.currentStyleBadge'));
    expect(cardOf('en', 'A')?.getAttribute('aria-current')).toBeNull();
  });

  it('offers the theme switch and applies the choice', () => {
    renderPage('C');
    const group = screen.getByRole('group', { name: t('en', 'theme.label') });
    fireEvent.click(within(group).getByRole('button', { name: t('en', 'theme.dark') }));
    expect(readThemePreference()).toBe('dark');
  });
});
