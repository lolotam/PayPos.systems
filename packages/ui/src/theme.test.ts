import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_BOOT_SCRIPT,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  setThemePreference,
  subscribeToThemePreference,
} from './theme';

type SystemThemeListener = (event: { matches: boolean }) => void;

function mockSystemTheme(matches = false) {
  const listeners: SystemThemeListener[] = [];
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: (_event: string, listener: SystemThemeListener) => listeners.push(listener),
  }));
  return listeners;
}

/** بديل mockSystemTheme: نظام بيتغيّر وقت التشغيل، والرسم بيتتبع قيمة matches الحالية مش قيمة التثبيت. */
function changeableSystemTheme(matches = false) {
  const state = { matches };
  const listeners: SystemThemeListener[] = [];
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return state.matches;
    },
    addEventListener: (_event: string, listener: SystemThemeListener) => listeners.push(listener),
    removeEventListener: vi.fn(),
  }));
  return {
    listeners,
    change(next: boolean) {
      state.matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

type LegacySystemThemeListener = (event: { matches: boolean }) => void;

/**
 * بديل قديم: المتصفحات والـ WebViews القديمة (زي سفاري و iOS 13 وأقدم) — الـ MediaQueryList
 * فيها لسه مش وريث من EventTarget، فبتعرض addListener و removeListener بس ومن غير
 * addEventListener خالص. فالتطبيق لازم يشتغل بالطريقتين عشان تغيير النظام يوصل للصفحة على
 * الأجهزة دي.
 */
function legacySystemTheme(matches = false) {
  const state = { matches };
  const listeners: LegacySystemThemeListener[] = [];
  const removeListener = vi.fn((listener: LegacySystemThemeListener) => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  });
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return state.matches;
    },
    addListener: (listener: LegacySystemThemeListener) => listeners.push(listener),
    removeListener,
  }));
  return {
    listeners,
    removeListener,
    change(next: boolean) {
      state.matches = next;
      for (const listener of [...listeners]) listener({ matches: next });
    },
  };
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

/** بيرجّع الصفحة لحالة قبل التشغيل: من غير مثيل ولا مفتاح محفوظ ولا كلاس dark ولا metas، فالنص يتقاس من الأول. */
function resetThemePage() {
  window.__pospayTheme?.dispose();
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.classList.remove('dark');
  document.head.innerHTML = '';
}

beforeEach(() => {
  mockSystemTheme();
  document.head.innerHTML = `
    <meta name="theme-color" content="${THEME_COLORS.light}" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="${THEME_COLORS.dark}" media="(prefers-color-scheme: dark)">`;
});

afterEach(() => {
  // المثيل الواحد لازم يموت مع كل اختبار: المستمعين والاختيار اللي في الذاكرة بيتحرروا معاه،
  // فالاختبار اللي بعده يبدأ نظيف بدل ما يرث مستمعين أو اختيار من صفحة قبله.
  window.__pospayTheme?.dispose();
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
    expect(listeners).toHaveLength(1);
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
});

describe('system theme changes', () => {
  it('follows system changes only while no theme is stored', () => {
    const system = changeableSystemTheme();
    new Function(THEME_BOOT_SCRIPT)();
    expect(system.listeners).toHaveLength(1);

    system.change(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    document.documentElement.classList.remove('dark');
    system.change(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('keeps the system listener registered with a stored theme, and the system takes over once the key is cleared', () => {
    const system = changeableSystemTheme();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(system.listeners).toHaveLength(1);

    system.change(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.removeItem(THEME_STORAGE_KEY);
    system.change(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('legacy WebViews without addEventListener', () => {
  it('the boot script subscribes through addListener and follows the system from light to dark to light', () => {
    const system = legacySystemTheme();
    new Function(THEME_BOOT_SCRIPT)();
    expect(system.listeners).toHaveLength(1);

    system.change(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    system.change(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('a legacy WebView hands the theme back to the system once the stored key is cleared', () => {
    const system = legacySystemTheme();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    localStorage.removeItem(THEME_STORAGE_KEY);
    system.change(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('disposing the runtime detaches the legacy listener', () => {
    const system = legacySystemTheme();
    new Function(THEME_BOOT_SCRIPT)();
    expect(system.listeners).toHaveLength(1);

    window.__pospayTheme?.dispose();
    expect(system.removeListener).toHaveBeenCalledTimes(1);
    expect(system.listeners).toHaveLength(0);
  });

  it('the runtime keeps one legacy listener and stops reacting to the system after dispose', () => {
    const system = legacySystemTheme();
    const listener = vi.fn();
    const unsubscribe = subscribeToThemePreference(listener);

    setThemePreference('dark');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(system.listeners).toHaveLength(1);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    window.__pospayTheme?.dispose();
    expect(system.removeListener).toHaveBeenCalledTimes(1);

    system.change(false);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    unsubscribe();
  });
});

describe('theme preference at runtime', () => {
  it('choosing the system removes the stored key and the owned meta', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    setThemePreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(ownedThemeColor()).toBeUndefined();
  });

  it('choosing dark stores the key, turns the page dark, and owns the browser bar', () => {
    setThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
  });

  it('the runtime helper reaches the same theme and owned meta as the boot script', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    const bootDark = document.documentElement.classList.contains('dark');
    const bootMeta = ownedThemeColor();

    window.__pospayTheme?.dispose();
    document.documentElement.classList.remove('dark');
    document.head.innerHTML = '';
    setThemePreference('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(bootDark);
    expect(ownedThemeColor()).toBe(bootMeta);
  });

  it('tells the subscribers when the choice changes in this tab or in another one', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToThemePreference(listener);

    setThemePreference('dark');
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'light' }),
    );
    expect(listener).toHaveBeenCalledTimes(2);

    window.dispatchEvent(new StorageEvent('storage', { key: 'other-key', newValue: 'x' }));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setThemePreference('light');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

/**
 * أي مقارنة على typeof window في السكربت المتولّد ممنوعة — المباشرة ضيقة أو واسعة،
 * والمعكوسة اللي المضغوطة ممكن تطلعها — لأن مترجم سيرفر Next بيبدّل typeof window
 * بالثابت "undefined" فيتجمّد الحرس. لكن typeof window.matchMedia مسموحة ومش بتتقاس.
 */
const BANNED_WINDOW_COMPARISON =
  /typeof window\s*[!=]==?|["']undefined["']\s*[!=]==?\s*typeof window(?![.\w])/;

describe('one runtime instance', () => {
  it('the module joins the runtime the boot script installed, so a second boot registers no second system listener', () => {
    const listeners = mockSystemTheme();
    new Function(THEME_BOOT_SCRIPT)();
    setThemePreference('dark');
    const unsubscribe = subscribeToThemePreference(() => {});
    new Function(THEME_BOOT_SCRIPT)();

    expect(listeners).toHaveLength(1);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);

    unsubscribe();
  });

  it('a theme stored in another tab applies through the boot listener with no subscriber mounted', () => {
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);
  });

  it('clearing the key from another tab hands the theme back to the light system and drops the owned meta', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);

    localStorage.removeItem(THEME_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: null }));

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(ownedThemeColor()).toBeUndefined();
  });

  it('clearing the stored key mid-session removes the owned meta once the system changes', () => {
    const system = changeableSystemTheme();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);

    localStorage.removeItem(THEME_STORAGE_KEY);
    system.change(false);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(ownedThemeColor()).toBeUndefined();
  });

  it('the boot script survives a missing matchMedia: stored dark still wins, nothing stored stays light', () => {
    vi.stubGlobal('matchMedia', undefined);
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(() => new Function(THEME_BOOT_SCRIPT)()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(ownedThemeColor()).toBe(THEME_COLORS.dark);

    resetThemePage();
    expect(() => new Function(THEME_BOOT_SCRIPT)()).not.toThrow();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(ownedThemeColor()).toBeUndefined();
  });

  it('the emitted boot script stays plain for old WebViews and turns a stored dark into a dark page', () => {
    // الصياغة الممنوعة: optional chaining أو nullish أو catch من غير معامل أو backtick أو helpers مترجمات — كلها بتكسر الـ WebViews القديمة.
    // ومقارنات typeof window ممنوعة كمان (BANNED_WINDOW_COMPARISON فوق) لكن typeof window.matchMedia مسموحة ومش بتتقاس.
    expect(THEME_BOOT_SCRIPT).not.toMatch(/catch\s*\{|\?\.|\?\?|`|__name\(/);
    expect(THEME_BOOT_SCRIPT).not.toMatch(BANNED_WINDOW_COMPARISON);

    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    new Function(THEME_BOOT_SCRIPT)();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
