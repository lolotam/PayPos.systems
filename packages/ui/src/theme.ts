export type Theme = 'light' | 'dark';

/** اختيار المستخدم للوضع: صريح (فاتح/غامق) أو تبع إعدادات النظام. */
export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'pospay-theme';

/** لون شريط المتصفح لكل وضع، مطابق لـ--background في packages/ui/src/styles/theme.css. */
export const THEME_COLORS: Record<Theme, string> = { light: '#EEF4F2', dark: '#0A1719' };

const META_SELECTOR = 'meta[name="theme-color"][data-pospay-theme]';

const FIRST_THEME_COLOR_SELECTOR = 'meta[name="theme-color"]';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * بيقرأ اختيار الوضع المخزَّن، ويرجع 'system' لو مفيش اختيار صريح.
 *
 * @returns الاختيار المخزَّن: 'light' أو 'dark' أو 'system'
 */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * الوضع الفعّال على الشاشة: الاختيار الصريح، أو وضع النظام لما الاختيار 'system'.
 *
 * @param preference الاختيار المحفوظ
 * @returns الوضع اللي المفروض يشتغل بيه
 */
export function effectiveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

/** بيعمل meta مملوكة للوضع المختار يدويًا، وتدرَجها قبل أول meta لـ theme-color. */
function createOwnedMeta(): Element {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('data-pospay-theme', '');
  const first = document.querySelector(FIRST_THEME_COLOR_SELECTOR);
  if (first?.parentNode) first.parentNode.insertBefore(meta, first);
  else document.head.prepend(meta);
  return meta;
}

/**
 * بيطبّق اختيار الوضع على الصفحة: كلاس dark على الـ html، والـ meta المملوكة لو الاختيار صريح.
 * في وضع 'system' الـ meta المملوكة بتتشال، فتبقى metas الخاصة بالنظام هي اللي بتحكم شريط المتصفح.
 *
 * @param preference الاختيار اللي يتطبّق
 */
function applyTheme(preference: ThemePreference): void {
  const theme = effectiveTheme(preference);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  if (preference === 'system') {
    document.querySelector(META_SELECTOR)?.remove();
    return;
  }
  const owned = document.querySelector(META_SELECTOR) ?? createOwnedMeta();
  owned.setAttribute('content', THEME_COLORS[theme]);
}

const preferenceListeners = new Set<() => void>();

function notifyPreferenceListeners(): void {
  for (const listener of preferenceListeners) listener();
}

/**
 * بيحفظ اختيار الوضع وبيطبّقه فورًا: 'light' و'dark' بيتخزنوا في localStorage، و'system' بيشيل المفتاح.
 *
 * @param preference الاختيار الجديد
 */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // التخزين متاحش (تصفح خاص مثلًا): الاختيار بيفضل على الصفحة الحالية بس،مش لحد إعادة التحميل.
  }
  applyTheme(preference);
  notifyPreferenceListeners();
}

/**
 * بيسجّل مستمع لتغيير وضع العرض: تغييره في نفس الصفحة، أو تغييره في تبويب تاني.
 *
 * @param listener بيتنادى كل ما الاختيار يتغيّر
 * @returns دالة لإلغاء الاشتراك
 */
export function subscribeToThemePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    preferenceListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * سكربت صغير يُشغَّل قبل الرسم ليمنع وميض الوضع الخاطئ، ويملك meta مستقلة للوضع المختار يدويًا.
 * الـ meta المملوكة تُدرَج قبل أول meta لـ theme-color في الشجرة، لأن المتصفح يعتمد أول واحدة تطابق الوسائط، وإلا غلبت metas الخاصة بالنظام على اختيار المستخدم.
 * مستمع prefers-color-scheme بيتسجَّل دايمًا، والمفتاح المخزَّن بيتقرأ وقت التغيير: كده مسح المفتاح في نص الجلسة
 * يرجّع التطبيق يتبع النظام تاني من غير إعادة تحميل.
 */
export const THEME_BOOT_SCRIPT = `(() => {
  var KEY = "${THEME_STORAGE_KEY}";
  var OWNED = '${META_SELECTOR}';
  var FIRST = '${FIRST_THEME_COLOR_SELECTOR}';
  var LIGHT = "${THEME_COLORS.light}";
  var DARK = "${THEME_COLORS.dark}";

  function stored() {
    try {
      return localStorage.getItem(KEY);
    } catch (error) {
      return null;
    }
  }

  function ownedMeta() {
    var meta = document.querySelector(OWNED);
    if (meta) return meta;
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('data-pospay-theme', '');
    var first = document.querySelector(FIRST);
    if (first && first.parentNode) first.parentNode.insertBefore(meta, first);
    else document.head.prepend(meta);
    return meta;
  }

  var media = matchMedia('(prefers-color-scheme: dark)');
  var choice = stored();
  var explicit = choice === 'light' || choice === 'dark';
  var dark = choice === 'dark' || (!explicit && media.matches);
  document.documentElement.classList.toggle('dark', dark);

  if (explicit) {
    ownedMeta().setAttribute('content', dark ? DARK : LIGHT);
  } else {
    var owned = document.querySelector(OWNED);
    if (owned) owned.remove();
  }

  media.addEventListener('change', function (event) {
    var current = stored();
    if (current === 'light' || current === 'dark') return;
    document.documentElement.classList.toggle('dark', event.matches);
  });
})();`;
