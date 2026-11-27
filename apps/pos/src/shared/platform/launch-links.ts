/** المفتاح اللي بيتحفظ بيه اللينك اللي اتعامل معاه في العملية الواحدة. */
const HANDLED_LAUNCH_URL_KEY = 'pospay.native.launchUrl';

/**
 * بيقرأ اللينك اللي التطبيق اتفتح بيه أول مرة (تشغيل بارد).
 *
 * نفس اللينك بيتقرا مرة واحدة في العملية الواحدة: إعادة تحميل الـ WebView من غير سبب
 * بتعيده تاني، وتطبيقه مرتين بيسيب الشاشة في حالة غلط. فبتسجل اللينك اللي اتعامل
 * معاه، وأي قراءة تانية له في نفس العملية بترجع فاضية.
 *
 * @returns اللينك، أو null لو مفيش لينك أو القراءة فشلت أو اللينك ده اتعامل معاه قبل كده
 */
export async function readLaunchLink(): Promise<string | null> {
  try {
    // الاستيراد هنا مش في أعلى الملف: نسخة الويب ما تتحملش إضافة Capacitor في حزمتها (FR-005).
    const { App } = await import('@capacitor/app');
    const launch = await App.getLaunchUrl();
    // نسخة الويب بترجع نص فاضي، فالنص الفاضي معناه مفيش لينك.
    const url = launch?.url ? launch.url : null;
    if (url === null) return null;
    if (readHandledLaunchUrl() === url) return null;
    rememberHandledLaunchUrl(url);
    return url;
  } catch {
    return null;
  }
}

/**
 * بيسمع للينكات اللي بتتفتح والتطبيق شغال (تشغيل دافي).
 *
 * @param listener بيتنادى بكل لينك
 * @returns دالة بيشيل بيها الاستماع
 */
export function onLinkOpened(listener: (url: string) => void): () => void {
  let removed = false;
  // نفس سبب القراءة فوق: الإضافة الأصلية ما بتوصلش لحزمة نسخة الويب (FR-005).
  const registration = import('@capacitor/app')
    .then(({ App }) => {
      // الدالة اللي بتشيل الاستماع ممكن تتنادى قبل ما الإضافة تتحمل، فمفيش تسجيل أصلاً.
      if (removed) return null;
      return App.addListener('appUrlOpen', (event) => listener(event.url));
    })
    .catch(() => null);
  return () => {
    removed = true;
    void registration
      .then((handle) => (handle === null ? undefined : handle.remove()))
      .catch(() => undefined);
  };
}

/** اللينك اللي اتعامل معاه في العملية دي، أو null لو مفيش ولا التخزين مقفول. */
function readHandledLaunchUrl(): string | null {
  try {
    return window.sessionStorage.getItem(HANDLED_LAUNCH_URL_KEY);
  } catch {
    // WebView مقيد بيمنع التخزين: كل قراءة بتعتبر أول مرة.
    return null;
  }
}

/** بيحفظ اللينك اللي اتعامل معاه، عشان إعادة تحميل الـ WebView ما تكررشه. */
function rememberHandledLaunchUrl(url: string): void {
  try {
    window.sessionStorage.setItem(HANDLED_LAUNCH_URL_KEY, url);
  } catch {
    // من غير تخزين مفيش تكرار يمنع، بس الخطأ ما بيوقّفش التطبيق.
  }
}
