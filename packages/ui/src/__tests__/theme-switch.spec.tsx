import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ThemeSwitch } from '../theme-switch.js';
import { THEME_STORAGE_KEY } from '../theme.js';

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

function choice(name: string) {
  return screen.getByRole('button', { name });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
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
});

it('names the group for screen readers', () => {
  systemTheme();
  render(<ThemeSwitch labels={labels} />);
  expect(screen.getByRole('group', { name: 'fixture.theme' })).toBeTruthy();
});
