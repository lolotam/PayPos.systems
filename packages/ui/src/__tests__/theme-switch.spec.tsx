import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ThemeSwitch } from '../theme-switch.js';
import { THEME_COLORS, THEME_STORAGE_KEY, subscribeToThemePreference } from '../theme.js';

const labels = {
  label: 'fixture.theme',
  light: 'fixture.light',
  dark: 'fixture.dark',
  system: 'fixture.system',
};

function systemTheme(matches = false) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

/** بديل systemTheme: نظام بيتغيّر وقت التشغيل، وبيجمع مستمعي تغيّره. */
function changeableSystemTheme(matches = false) {
  const state = { matches };
  const listeners: ((event: { matches: boolean }) => void)[] = [];
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return state.matches;
    },
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.push(listener);
    },
    removeEventListener: vi.fn(),
  }));
  return {
    change(matches: boolean) {
      state.matches = matches;
      for (const listener of listeners) listener({ matches });
    },
  };
}

function choice(name: string) {
  return screen.getByRole('button', { name });
}

/** الـ meta المملوكة للوضع المختار يدويًا — هي اللي بتحكم شريط المتصفح وقت الاختيار الصريح. */
function ownedThemeColor() {
  return document
    .querySelector('meta[name="theme-color"][data-pospay-theme]')
    ?.getAttribute('content');
}

beforeEach(() => {
  document.head.innerHTML = `
    <meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)">`;
});

afterEach(() => {
  // dispose بيهدم المثيل الواحد بالمستمعين والاختيار اللي في الذاكرة مع كل اختبار،
  // فالاختبار اللي بعده يبدأ نظيف بدل ما نرجّع الاختيار للنظام بإيدنا.
  window.__pospayTheme?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.head.innerHTML = '';
});

it('marks the chosen option as pressed and turns the page dark', () => {
  systemTheme();
  render(<ThemeSwitch labels={labels} />);

  expect(choice('fixture.system').getAttribute('aria-pressed')).toBe('true');
  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('false');

  fireEvent.click(choice('fixture.dark'));

  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
  expect(choice('fixture.light').getAttribute('aria-pressed')).toBe('false');
  expect(choice('fixture.system').getAttribute('aria-pressed')).toBe('false');
  expect(choice('fixture.dark').classList.contains('bg-brand')).toBe(true);
  expect(choice('fixture.light').classList.contains('bg-brand')).toBe(false);
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
});

it('goes back to the system theme, clears the stored key, and follows the system setting', () => {
  systemTheme(true);
  localStorage.setItem(THEME_STORAGE_KEY, 'light');
  render(<ThemeSwitch labels={labels} />);

  expect(choice('fixture.light').getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(choice('fixture.system'));

  expect(choice('fixture.system').getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  expect(document.documentElement.classList.contains('dark')).toBe(true);
});

it('follows a theme chosen in another tab', () => {
  systemTheme();
  render(<ThemeSwitch labels={labels} />);
  expect(choice('fixture.system').getAttribute('aria-pressed')).toBe('true');

  act(() => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));
  });

  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
  expect(choice('fixture.system').getAttribute('aria-pressed')).toBe('false');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
});

it('keeps the choice on screen when the browser refuses to store it', () => {
  systemTheme();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  render(<ThemeSwitch labels={labels} />);

  fireEvent.click(choice('fixture.dark'));

  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
});

it('follows the system setting after the page is up, and tells the subscribers', () => {
  const system = changeableSystemTheme();
  const listener = vi.fn();
  const unsubscribe = subscribeToThemePreference(listener);
  render(<ThemeSwitch labels={labels} />);

  act(() => {
    system.change(true);
  });

  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(listener).toHaveBeenCalled();
  expect(choice('fixture.system').getAttribute('aria-pressed')).toBe('true');

  unsubscribe();
});

it('keeps an explicit choice when the system setting changes', () => {
  const system = changeableSystemTheme();
  render(<ThemeSwitch labels={labels} />);

  fireEvent.click(choice('fixture.dark'));

  act(() => {
    system.change(false);
  });

  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
});

it('keeps an explicit dark choice on screen when the browser refuses to store it, even as the system turns light', () => {
  const system = changeableSystemTheme(true);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  render(<ThemeSwitch labels={labels} />);

  fireEvent.click(choice('fixture.dark'));
  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(ownedThemeColor()).toBe(THEME_COLORS.dark);

  act(() => {
    system.change(false);
  });

  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
});

it('keeps a refused dark choice when the system changes while an older light value is still stored', () => {
  // القيمة القديمة 'light' لسه في التخزين والكتابة الجديدة مرفوضة: اختيار الذاكرة 'dark'
  // هو الأحدث، فتغيّر النظام لازم ما يرجّعش الصفحة لورا للقيمة المخزَّنة الأقدم منه.
  const system = changeableSystemTheme(true);
  localStorage.setItem(THEME_STORAGE_KEY, 'light');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  render(<ThemeSwitch labels={labels} />);

  fireEvent.click(choice('fixture.dark'));
  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');

  act(() => {
    system.change(false);
  });

  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
});

it('serves re-renders from the cached preference instead of reading localStorage again', () => {
  systemTheme();
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');
  const { rerender } = render(<ThemeSwitch labels={labels} />);
  const getItem = vi.spyOn(Storage.prototype, 'getItem');

  rerender(<ThemeSwitch labels={labels} />);
  rerender(<ThemeSwitch labels={labels} />);
  rerender(<ThemeSwitch labels={labels} />);

  expect(choice('fixture.dark').getAttribute('aria-pressed')).toBe('true');
  expect(getItem).not.toHaveBeenCalled();
});

it('names the group for screen readers', () => {
  systemTheme();
  render(<ThemeSwitch labels={labels} />);
  expect(screen.getByRole('group', { name: 'fixture.theme' })).toBeTruthy();
});
