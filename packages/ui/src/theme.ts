export type Theme = 'light' | 'dark';

/** اختيار المستخدم للوضع: صريح (فاتح/غامق) أو تبع إعدادات النظام. */
export type ThemePreference = Theme | 'system';

export const THEME_STORAGE_KEY = 'pospay-theme';

/** لون شريط المتصفح لكل وضع، مطابق لـ--background في packages/ui/src/styles/theme.css. */
export const THEME_COLORS: Record<Theme, string> = { light: '#EEF4F2', dark: '#0A1719' };

/**
 * واصف meta الـ theme-color لكل وضع: تطبيق الويب وتطبيق POS بياخدوا نفس الواصف،
 * عشان شريط المتصفح يبقى متطابق في التنين والـ metas ما تتبنيش بإيد مرتين.
 */
export const THEME_COLOR_METAS: { media: string; content: string }[] = [
  { media: '(prefers-color-scheme: light)', content: THEME_COLORS.light },
  { media: '(prefers-color-scheme: dark)', content: THEME_COLORS.dark },
];

/**
 * الوضع الفعّال على الشاشة: الاختيار الصريح، أو وضع النظام لما الاختيار 'system'.
 *
 * @param preference الاختيار المحفوظ
 * @returns الوضع اللي المفروض يشتغل بيه
 */
export function effectiveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference;
  return prefersDarkSystemTheme() ? 'dark' : 'light';
}

/** الوضع الغامق حسب النظام: البيئات اللي من غير matchMedia (SSR، اختبارات) بتعتبر الفاتح هو الآمن. */
function prefersDarkSystemTheme(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(THEME_RUNTIME_CONFIG.darkMediaQuery).matches;
}

/**
 * إعدادات مشغّل الوضع. سكربت الإقلاع والموديول بياخدوا نفس الكائن ده،
 * فمفيش مفاتيح أو محددات ليها نسخة تانية تتشعب بين السلسلة المتسلسلة والكود.
 */
type ThemeRuntimeConfig = {
  storageKey: string;
  ownedMetaSelector: string;
  firstThemeColorSelector: string;
  darkMediaQuery: string;
  lightColor: string;
  darkColor: string;
  /** اسم الخاصية على window اللي المثيل الوحيد بيتخزن عليه. */
  handle: '__pospayTheme';
};

/**
 * المصدر الوحيد للقيم: سكربت الإقلاع بياخدها متسلسلة JSON، والموديول بيمررها كما هي،
 * فالنص اللي بيصل للـ HTML مبني من نفس الكائن اللي الموديول بيشتغل بيه.
 */
const THEME_RUNTIME_CONFIG: ThemeRuntimeConfig = {
  storageKey: THEME_STORAGE_KEY,
  ownedMetaSelector: 'meta[name="theme-color"][data-pospay-theme]',
  firstThemeColorSelector: 'meta[name="theme-color"]',
  darkMediaQuery: '(prefers-color-scheme: dark)',
  lightColor: THEME_COLORS.light,
  darkColor: THEME_COLORS.dark,
  handle: '__pospayTheme',
};

/** الرسام اللي createThemePainter بيرجعه: استعلام وسائط النظام محجوز مرة، ورسام الوضع. */
type ThemePainter = {
  media: MediaQueryList | null;
  paint: (preference: ThemePreference) => void;
};

type ThemePainterFactory = (config: ThemeRuntimeConfig) => ThemePainter;

/**
 * المخزن اللي createThemeStore بيرجّعه: القراءة بتقبل الاختيار الصريح بس،
 * والكتابة بتبلّغ بالفشل بدل ما تكسر الصفحة.
 */
type ThemeStore = {
  /** بيقرأ الاختيار المخزَّن: 'light' أو 'dark'، أو null لو مفيش قيمة صالحة أو التخزين رفض القراءة. */
  read: () => Theme | null;
  /** بيكتب الاختيار ('system' بيشيل المفتاح) وبيرجّع false لو التخزين رفض الكتابة. */
  write: (preference: ThemePreference) => boolean;
};

type ThemeStoreFactory = (config: ThemeRuntimeConfig) => ThemeStore;

/* eslint-disable no-var, @typescript-eslint/no-dynamic-delete, @typescript-eslint/no-unused-vars --
   نص الدوال الأربعة دي بيتولّد في THEME_BOOT_SCRIPT وبيشتغل خام في الـ HTML من غير أي ترجمة،
   فالصياغة الـ plain (var والحذف الديناميكي للمقبض) مقصودة: مترجمات الإنتاج ما بتحقنش
   helpers، والـ WebViews القديمة بتشغّل السكربت كما هو. ومن ممنوعات نصوصها كذلك أي typeof window
   متبوعة بمقارنة: مترجمات سيرفر Next بتستبدلها بالثابت "undefined" فيتجمّد الحرس في السكربت المتولّد.
   والاستثناء من no-unused-vars هنا بس
   عشان معامل catch (error) المقصود ما بيتستخدمش: الربط الإجباري للخطأ هو اللي بيمنع
   optional catch binding اللي بتكسر السكربت على الـ WebViews القديمة. الباقي في الملف بيفضل مفحوص عادي. */
/**
 * بترجع رسام الوضع: بتحجز استعلام prefers-color-scheme مرة واحدة ورا حرس typeof (عالج #1082.5).
 * الرسم بيكتب كلاس dark على الـ html، وبيملك meta شريط المتصفح للاختيار الصريح أو بيشيلها
 * لما الاختيار 'system' (عالج #1082.3). الدالة دي نصّها بيتولّد جوّه THEME_BOOT_SCRIPT،
 * فلازم تكون معزولة تمامًا: كل حاجة بتدخل من الباراميترات، وصياغة plain (var/function)
 * من غير optional chaining ولا spread، عشان مترجمات الإنتاج ما تحقنش helpers
 * والـ WebViews القديمة تشغّلها كما هي.
 *
 * @param config إعدادات المشغّل: المفاتيح والمحددات والألوان
 * @returns رسام بـ media محجوزة و paint
 */
function createThemePainter(config: ThemeRuntimeConfig): ThemePainter {
  var media: MediaQueryList | null = null;
  // الحرس على window.matchMedia لوحدها من غير typeof window: مترجم سيرفر Next بيبدّل typeof window
  // جوّه الدالة المتسلسلة بالثابت "undefined"، فيتجمّد الحرس على false في سكربت الإقلاع
  // والصفحة ما تتبعش تغيّر النظام أبدًا. السكربت والمثبت بيتشغّلوا في المتصفح بس.
  if (typeof window.matchMedia === 'function') {
    media = window.matchMedia(config.darkMediaQuery);
  }

  function systemIsDark(): boolean {
    if (media) return media.matches;
    return false;
  }

  // الـ meta المملوكة بتتدرج قبل أول theme-color: المتصفح بيعتمد أول واحدة تطابق الوسائط،
  // فمن غير التدرج ده metas النظام بتغلب اختيار المستخدم على شريط المتصفح.
  function ownedMeta(): Element {
    var meta = document.querySelector(config.ownedMetaSelector);
    if (meta) return meta;
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('data-pospay-theme', '');
    var first = document.querySelector(config.firstThemeColorSelector);
    if (first && first.parentNode) first.parentNode.insertBefore(meta, first);
    else document.head.prepend(meta);
    return meta;
  }

  /**
   * بيطبّق الاختيار على الصفحة: كلاس dark على الـ html، وmeta مملوكة بمحتوى الوضع الفعّال
   * للاختيار الصريح. في 'system' الـ meta المملوكة بتتشال حتى لو اتسيبت من جلسة قبلها،
   * فmetas الخاصة بالنظام ترجع هي اللي بتحكم شريط المتصفح.
   */
  function paint(preference: ThemePreference): void {
    var dark = preference === 'dark' || (preference === 'system' && systemIsDark());
    document.documentElement.classList.toggle('dark', dark);
    if (preference === 'system') {
      var owned = document.querySelector(config.ownedMetaSelector);
      if (owned) owned.remove();
      return;
    }
    ownedMeta().setAttribute('content', dark ? config.darkColor : config.lightColor);
  }

  return { media: media, paint: paint };
}

/**
 * مقبض المثيل الواحد لمشغّل الوضع على الصفحة. سكربت الإقلاع والموديول بيلتقوا
 * على نفس المثيل عبر window.__pospayTheme، فما بيبقاش منطق وضع بيعيش مرتين.
 */
export type ThemeRuntime = {
  /** الاختيار الحالي من الذاكرة المؤقتة — من غير قراءة تانية من التخزين (عالج #1082.6). */
  get(): ThemePreference;
  /** بيحفظ الاختيار وبيطبّقه وبيبلّغ المشتركين فورًا. */
  set(preference: ThemePreference): void;
  /**
   * بيسجّل مستمع يتندّى عند أي تغيير: من نفس الصفحة، من تبويب تاني، أو من النظام.
   *
   * @param listener بيتندّى كل ما الاختيار يتغيّر
   * @returns دالة إلغاء الاشتراك
   */
  subscribe(listener: () => void): () => void;
  /**
   * للاختبارات: بيفك المستمعين وبيمسح المشتركين المركّبين وبيشيل المقبض من window.
   * المشترك المركّب بيسقط مع النداء، فلازم يشترك تاني في المثيل الجديد بعد إعادة التثبيت.
   */
  dispose(): void;
};

declare global {
  interface Window {
    __pospayTheme?: ThemeRuntime;
  }
}

/**
 * بيرجّع مخزن اختيار الوضع: القراءة بتجيب المفتاح من localStorage وبتقبل 'light'/'dark' بس،
 * وأي قيمة تانية أو رفض قراءة بترجّع null، والكتابة بتحفظ الاختيار الصريح وبتشيل المفتاح
 * في 'system' وبتبلّغ بالفشل بدل ما تكسر سكربت الإقلاع. الدالة دي نصّها بيتولّد جوّه
 * THEME_BOOT_SCRIPT زي دالتي createThemePainter وinstallThemeRuntime، فلازم تكون معزولة
 * تمامًا: كل حاجة بتدخل من الباراميترات، وصياغة plain (var/function) من غير optional chaining
 * ولا nullish ولا spread ولا template literals، عشان مترجمات الإنتاج ما تحقنش helpers
 * والـ WebViews القديمة تشغّلها كما هي.
 *
 * @param config إعدادات المشغّل: مفتاح التخزين
 * @returns مخزن الاختيار بـ read وwrite
 */
function createThemeStore(config: ThemeRuntimeConfig): ThemeStore {
  /** بيقرأ الاختيار المخزَّن: الصريح ('light'/'dark') بس هو اللي بيتقبل، وأي حاجة تانية null. */
  function read(): Theme | null {
    try {
      var stored = localStorage.getItem(config.storageKey);
      if (stored === 'light' || stored === 'dark') return stored;
      return null;
    } catch (error) {
      // التخزين مش متاح (تصفح خاص مثلًا): مفيش قيمة محفوظة نقدر نعتمدها.
      return null;
    }
  }

  /** بيكتب الاختيار ('system' بيشيل المفتاح) وبيبلّغ بالفشل بدل ما يكسر النداء. */
  function write(preference: ThemePreference): boolean {
    try {
      if (preference === 'system') localStorage.removeItem(config.storageKey);
      else localStorage.setItem(config.storageKey, preference);
      return true;
    } catch (error) {
      // التخزين رفض الكتابة: false عشان النداء يحتفظ بالاختيار في الذاكرة.
      return false;
    }
  }

  return { read: read, write: write };
}

/**
 * مصنع الاشتراك في وسائط النظام: بيرجّع دالة إلغاء الاشتراك، أو null لو مفيش طريقة للاشتراك.
 */
type MediaListenerFactory = (
  media: MediaQueryList | null,
  listener: () => void,
) => (() => void) | null;

/**
 * بيسجّل مستمع لتغيّر وضع النظام بالطريقة اللي المتصفح بيعرفها: addEventListener في المتصفحات
 * الحديثة، و addListener في المتصفحات والـ WebViews القديمة — اللي الـ MediaQueryList فيها لسه
 * مش وريث من EventTarget (زي سفاري و iOS 13 وأقدم). من غير الـ fallback ده تغيير النظام ما
 * بيوصلش للصفحة على الأجهزة دي. الدالة دي نصّها بيتولّد جوّه THEME_BOOT_SCRIPT زي دوال المشغّل
 * التانية، فصياغتها plain (function) من غير optional chaining ولا spread ولا template literals.
 *
 * @param media استعلام وسائط النظام، أو null لو المتصفح مافيش فيه matchMedia
 * @param listener بيتندّى كل ما وضع النظام يتغيّر
 * @returns دالة إلغاء الاشتراك، أو null لو مفيش طريقة للاشتراك
 */
function listenMedia(media: MediaQueryList | null, listener: () => void): (() => void) | null {
  if (!media) return null;
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', listener);
    return function unlistenModern() {
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', listener);
    };
  }
  if (typeof media.addListener === 'function') {
    media.addListener(listener);
    return function unlistenLegacy() {
      if (typeof media.removeListener === 'function') media.removeListener(listener);
    };
  }
  return null;
}

/**
 * بيركّب المثيل الواحد لمشغّل الوضع على window: لو المقبض موجود بيرجّعه زي ما هو (idempotent)،
 * فالموديول وسكربت الإقلاع ما بيركّبوش مستمعين مرة تانية (عالج #1082.4). مستمع storage
 * ومستمع prefers-color-scheme بيعيشوا في نفس الغلق اللي فيه الاختيار اللي في الذاكرة،
 * فتغيّر النظام ما بيتقدرش يمسح اختيار صريح اتحفظ وقت فشل التخزين (عالج #1082.1)،
 * ومستمع التخزين شغال على كل صفحة حتى من غير ThemeSwitch (عالج #1082.2). الدوال الأربع
 * نفسها نصّها بيتولّد في THEME_BOOT_SCRIPT، فمعزولة تمامًا: كل حاجة من الباراميترات
 * وصياغة plain (var/function) من غير optional chaining ولا spread ولا destructuring،
 * عشان مترجمات الإنتاج ما تحقنش helpers والـ WebViews القديمة تشغّلها كما هي.
 *
 * @param config إعدادات المشغّل: المفاتيح والمحددات والألوان واسم المقبض
 * @param createPainter مصنع الرسام اللي بيرسم الوضع على الصفحة
 * @param createStore مصنع المخزن اللي بيقرأ ويكتب اختيار الوضع المحفوظ
 * @param listenMedia مصنع الاشتراك في وسائط النظام، وبيقبل الـ WebViews القديمة
 * @returns المثيل المثبّت على window[config.handle]
 */
function installThemeRuntime(
  config: ThemeRuntimeConfig,
  createPainter: ThemePainterFactory,
  createStore: ThemeStoreFactory,
  listenMedia: MediaListenerFactory,
): ThemeRuntime {
  if (window[config.handle]) return window[config.handle] as ThemeRuntime;
  var painter = createPainter(config);
  var store = createStore(config);
  var memoryPreference: ThemePreference | null = null;
  var subscribers = new Set<() => void>();
  var current: ThemePreference = read();
  var runtime: ThemeRuntime = { get: get, set: set, subscribe: subscribe, dispose: dispose };
  painter.paint(current);
  if (typeof window.addEventListener === 'function')
    window.addEventListener('storage', handleStorageEvent);
  var unlistenMedia = listenMedia(painter.media, refresh);
  // المقبض بيتنشر آخر خطوة: لو الرسم أو التسجيل فشل، مفيش مثيل مكسور من غير مستمعين
  // بيفضل معلّق على window وكل نداء لاحق بيلتحق بيه — النداء الجاي بيركّب من الأول.
  window[config.handle] = runtime;
  return runtime;

  /**
   * بيقرأ الاختيار وقت النداء: اختيار الذاكرة بيفوز الأول، لأنه ما بيتولّدش غير لما التخزين
   * يرفض كتابة آخر اختيار، فأي قيمة في التخزين ساعتها أقدم من قرار المستخدم الأخير
   * وتغيّر النظام ما يقدرش يرجّعه لورا. بعدها القيمة المخزَّنة الصريحة، وإلا 'system'.
   */
  function read(): ThemePreference {
    if (memoryPreference) return memoryPreference;
    return store.read() || 'system';
  }

  /** بيرسم الاختيار الجديد ويحدّث الذاكرة المؤقتة ويبلّغ المشتركين — مسار موحّد لكل تغيير. */
  function applyCurrent(preference: ThemePreference): void {
    current = preference;
    painter.paint(current);
    subscribers.forEach(function (listener) {
      listener();
    });
  }

  /**
   * إعادة القراءة من التخزين فُرضت عمدًا: مسح المفتاح في نفس التبويب ما بيطلعش حدث storage،
   * وتغيّر النظام هو آخر فرصة يعيد فيها التطبيق اتباع النظام، والرسم الكامل بيشيل
   * الـ meta المملوكة اللي اتسيبت من اختيار صريح قديم.
   */
  function refresh(): void {
    applyCurrent(read());
  }

  /** بيحفظ الاختيار عن طريق المخزن: الكتابة الناجحة بتسقط الاختيار اللي في الذاكرة، والفاشلة بتسيبه عشان يفضل ظاهر. */
  function set(preference: ThemePreference): void {
    memoryPreference = store.write(preference) ? null : preference;
    applyCurrent(preference);
  }

  /**
   * التخزين اتغيّر في تبويب تاني: لازم الوضع يتطبّق على الصفحة دي زي ما اتطبّق هناك،
   * مش بس يحدّث القارئات. الحدث ده بيأكد إن التخزين شغال في هذا الأصل، فنسقط الاختيار اللي في الذاكرة.
   */
  function handleStorageEvent(event: StorageEvent): void {
    if (event.key !== null && event.key !== config.storageKey) return;
    memoryPreference = null;
    refresh();
  }

  function get(): ThemePreference {
    return current;
  }

  function subscribe(listener: () => void): () => void {
    subscribers.add(listener);
    return function unsubscribe() {
      subscribers.delete(listener);
    };
  }

  function dispose(): void {
    if (typeof window.removeEventListener === 'function')
      window.removeEventListener('storage', handleStorageEvent);
    if (unlistenMedia) unlistenMedia();
    // المشتركين بيمسحوا مع المثيل: بعد dispose المثيل مات، فمستمع لسه شايل إشارة ليه
    // ما يتناداش على حالة قديمة لو المثيل اتركّب تاني.
    subscribers.clear();
    delete window[config.handle];
  }
}

/* eslint-enable no-var, @typescript-eslint/no-dynamic-delete, @typescript-eslint/no-unused-vars */

/**
 * بوابة الموديول للمثيل المشترك. التثبيت أول نداء عميل بس، مش عند الاستيراد:
 * عشان tree-shaking يقدر يشيل الملف من الباقات اللي ما بتستخدموش،
 * والاختبارات تقدر تجهّز matchMedia والتخزين قبل التثبيت.
 */
function themeRuntime(): ThemeRuntime {
  return installThemeRuntime(THEME_RUNTIME_CONFIG, createThemePainter, createThemeStore, listenMedia);
}

/**
 * بيقرأ اختيار الوضع من المثيل المشترك: 'light' أو 'dark' أو 'system'.
 * على السيرفر مفيش window ولا تخزين، فبيرجّع 'system' من غير ما يثبّت أي حاجة.
 *
 * @returns الاختيار الحالي: 'light' أو 'dark' أو 'system'
 */
export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  return themeRuntime().get();
}

/**
 * بيحفظ اختيار الوضع على المثيل المشترك: 'light' و'dark' في localStorage، و'system' بيشيل المفتاح،
 * ولو التخزين فشل الاختيار بيفضل في الذاكرة. الرسم على الصفحة والتنبيه بيدوروا في نفس المثيل،
 * فسكربت الإقلاع والمبدّل ما بيقسموش الحالة بينهم.
 *
 * @param preference الاختيار الجديد
 */
export function setThemePreference(preference: ThemePreference): void {
  themeRuntime().set(preference);
}

/**
 * بيسجّل مستمع على المثيل المشترك: تغيّر من نفس الصفحة، من تبويب تاني، أو من النظام.
 *
 * @param listener بيتندّى كل ما الاختيار يتغيّر
 * @returns دالة لإلغاء الاشتراك
 */
export function subscribeToThemePreference(listener: () => void): () => void {
  return themeRuntime().subscribe(listener);
}

/**
 * سكربت الإقلاع مش نص مكتوب بالإيد: بيتولّد من دوال المشغّل نفسهم — الرسام، المخزن، مالك
 * الحالة، ومشترك وسائط النظام — فمنطق الوضع بيعيش مرة واحدة والنسخة اللي بتوصل للـ HTML هي نفس
 * كود الموديول متسلسل (عالج #1082.4). بيتشغّل قبل الرسم على كل صفحة — حتى من غير ThemeSwitch —
 * فبيرسم الوضع الصح ويقفل المستمعين من أول لحظة، والمبدّل بعدين بيلتقي على نفس المثيل
 * بدل ما يركّب واحد تاني.
 */
export const THEME_BOOT_SCRIPT = `(${installThemeRuntime.toString()})(${JSON.stringify(THEME_RUNTIME_CONFIG)},${createThemePainter.toString()},${createThemeStore.toString()},${listenMedia.toString()});`;
