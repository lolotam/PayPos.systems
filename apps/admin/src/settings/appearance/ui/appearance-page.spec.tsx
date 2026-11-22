import { t } from '@pospay/i18n';
import { DirectionProvider, readThemePreference, setThemePreference } from '@pospay/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NavigationStyle } from '@/workspace/nav-types';

import { AppearancePage } from './appearance-page';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

const NAMES = {
  A: 'adminNav.styleALabel',
  B: 'adminNav.styleBLabel',
  C: 'adminNav.styleCLabel',
} as const;

/** مضيف يحتفظ بالنمط كما يفعل إطار لوحة الإدارة، فيُرى أثر الضغط في الصفحة نفسها. */
function Host({ initial }: { initial: NavigationStyle }) {
  const [style, setStyle] = useState(initial);
  return <AppearancePage style={style} onChoose={setStyle} />;
}

function renderPage(initial: NavigationStyle) {
  render(
    <DirectionProvider dir={state.locale === 'ar' ? 'rtl' : 'ltr'}>
      <Host initial={initial} />
    </DirectionProvider>,
  );
}

const card = (_locale: 'en' | 'ar', style: NavigationStyle) =>
  document.querySelector<HTMLElement>(`[data-style="${style}"]`);
const isMarkedCurrent = (style: NavigationStyle) => card('en', style)?.hasAttribute('aria-current');

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
    const current = card(locale, 'C') as HTMLElement;
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.textContent).toContain(t(locale, 'adminNav.currentStyleBadge'));
    expect(within(current).queryByRole('button')).toBeNull();
    const choices = screen.getAllByRole('button', {
      name: new RegExp(t(locale, 'adminNav.chooseStyleAction')),
    });
    expect(choices).toHaveLength(2);
  });
});

describe('Appearance choices', () => {
  it('moves the current mark to the card that was chosen and gives the old one its button back', () => {
    renderPage('C');
    expect(isMarkedCurrent('A')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('en', NAMES.A)) }));
    expect(isMarkedCurrent('A')).toBe(true);
    expect(isMarkedCurrent('C')).toBe(false);
    expect(within(card('en', 'A') as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(card('en', 'C') as HTMLElement).getByRole('button')).toBeTruthy();
  });

  it('can be switched again and again, ending on the last choice', () => {
    renderPage('C');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('en', NAMES.A)) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('en', NAMES.B)) }));
    expect(isMarkedCurrent('B')).toBe(true);
    expect(isMarkedCurrent('A')).toBe(false);
  });

  it('offers the theme switch and applies the choice', () => {
    renderPage('C');
    const group = screen.getByRole('group', { name: t('en', 'theme.label') });
    fireEvent.click(within(group).getByRole('button', { name: t('en', 'theme.dark') }));
    expect(readThemePreference()).toBe('dark');
  });
});
