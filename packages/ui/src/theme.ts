/** وضع العرض: فاتح أو داكن. */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pospay-theme';

/** لون شريط المتصفح لكل وضع، مطابق لـ--background في src/styles.css. */
export const THEME_COLORS: Record<Theme, string> = { light: '#EEF4F2', dark: '#0A1719' };

const META_SELECTOR = 'meta[name="theme-color"]';

/** سكربت صغير يُشغَّل قبل الرسم ليمنع وميض الوضع الخاطئ، ويلوّن شريط المتصفح بالوضع المختار يدويًا. */
export const THEME_BOOT_SCRIPT = `(()=>{var t;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);if(t==="dark"||t==="light")document.querySelectorAll('${META_SELECTOR}').forEach(function(m){m.setAttribute("content",d?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")})})();`;

export function readTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document
    .querySelectorAll(META_SELECTOR)
    .forEach((meta) => meta.setAttribute('content', THEME_COLORS[theme]));
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    return;
  }
}
