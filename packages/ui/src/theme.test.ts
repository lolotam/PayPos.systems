import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_BOOT_SCRIPT, THEME_COLORS, THEME_STORAGE_KEY, applyTheme } from './theme';

function themeColors() {
  return [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute('content'),
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  document.head.innerHTML = `
    <meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)">`;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('browser theme color', () => {
  it.each(['light', 'dark'] as const)('a %s theme picked by hand colors both metas', (theme) => {
    applyTheme(theme);
    expect(themeColors()).toEqual([THEME_COLORS[theme], THEME_COLORS[theme]]);
  });

  it('the boot script restores a stored dark theme before paint', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(themeColors()).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
  });

  it('without a stored theme the metas keep following the system setting', () => {
    new Function(THEME_BOOT_SCRIPT)();
    expect(themeColors()).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });
  it('explicit light overrides a dark system and a previously dark document', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.documentElement.classList.add('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(themeColors()).toEqual([THEME_COLORS.light, THEME_COLORS.light]);
  });

  it('uses system dark when storage is unavailable', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies dark and updates browser colors even when persistence fails', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(themeColors()).toEqual([THEME_COLORS.dark, THEME_COLORS.dark]);
  });
});
