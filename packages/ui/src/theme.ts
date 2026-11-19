/** وضع العرض: فاتح أو داكن. */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'pospay-theme';

/** لون شريط المتصفح لكل وضع، مطابق لـ--background في packages/ui/src/styles/theme.css. */
export const THEME_COLORS: Record<Theme, string> = { light: '#EEF4F2', dark: '#0A1719' };

const META_SELECTOR = 'meta[name="theme-color"][data-pospay-theme]';

/** سكربت صغير يُشغَّل قبل الرسم ليمنع وميض الوضع الخاطئ، ويملك meta مستقلة للوضع المختار يدويًا. */
export const THEME_BOOT_SCRIPT = `(()=>{var t;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}var q=matchMedia("(prefers-color-scheme: dark)"),d=t==="dark"||(t!=="light"&&q.matches);document.documentElement.classList.toggle("dark",d);var m=document.querySelector('${META_SELECTOR}');if(t==="dark"||t==="light"){if(!m){m=document.createElement("meta");m.setAttribute("name","theme-color");m.setAttribute("data-pospay-theme","");document.head.appendChild(m)}m.setAttribute("content",d?"${THEME_COLORS.dark}":"${THEME_COLORS.light}")}else{if(m)m.remove();q.addEventListener("change",function(e){var s;try{s=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}if(s!=="dark"&&s!=="light")document.documentElement.classList.toggle("dark",e.matches)})}})();`;
