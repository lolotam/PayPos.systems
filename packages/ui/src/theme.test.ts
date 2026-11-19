import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_BOOT_SCRIPT, THEME_COLORS, THEME_STORAGE_KEY } from './theme';

type SystemThemeListener = (event: { matches: boolean }) => void;

function mockSystemTheme(matches = false) {
  const listeners: SystemThemeListener[] = [];
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: (_event: string, listener: SystemThemeListener) => listeners.push(listener),
  }));
  return listeners;
}

function systemThemeColors() {
  return [...document.querySelectorAll('meta[name="theme-color"]:not([data-pospay-theme])')].map(
    (meta) => meta.getAttribute('content'),
  );
}

function ownedThemeColor() {
  return document
    .querySelector('meta[name="theme-color"][data-pospay-theme]')
    ?.getAttribute('content');
}

/** أول meta لـ theme-color في الشجرة — المتصفح يعتمد عليها، فالمملوكة لازم تكون هي. */
function firstThemeColorIsOwned() {
  const first = document.head.querySelector('meta[name="theme-color"]');
  return first?.hasAttribute('data-pospay-theme') ?? false;
}

beforeEach(() => {
  mockSystemTheme();
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
  it('the boot script restores a stored dark theme without mutating React-owned metas', () => {
    const listeners = mockSystemTheme();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(systemThemeColors()).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
    expect(listeners).toHaveLength(0);
  });

  it('puts the owned meta before the system metas so the stored choice wins the browser bar', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    new Function(THEME_BOOT_SCRIPT)();
    expect(firstThemeColorIsOwned()).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.light);
    expect(systemThemeColors()).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
  });

  it('prepends the owned meta when the document has no theme-color meta yet', () => {
    document.head.innerHTML = '';
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(firstThemeColorIsOwned()).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
  });

  it('without a stored theme the metas keep following the system setting', () => {
    new Function(THEME_BOOT_SCRIPT)();
    expect(systemThemeColors()).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
    expect(ownedThemeColor()).toBeUndefined();
  });

  it('explicit light overrides a dark system and a previously dark document', () => {
    mockSystemTheme(true);
    document.documentElement.classList.add('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(systemThemeColors()).toEqual([THEME_COLORS.light, THEME_COLORS.dark]);
    expect(ownedThemeColor()).toBe(THEME_COLORS.light);
  });

  it('uses system dark when storage is unavailable', () => {
    mockSystemTheme(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(ownedThemeColor()).toBeUndefined();
  });

  it('follows system changes only while no theme is stored', () => {
    const listeners = mockSystemTheme();
    new Function(THEME_BOOT_SCRIPT)();
    expect(listeners).toHaveLength(1);

    listeners[0]?.({ matches: true });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.classList.remove('dark');
    listeners[0]?.({ matches: true });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
