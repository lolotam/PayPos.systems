/** المفتاح اللي بيتحفظ بيه بصمة اللينك اللي اتعامل معاه في العملية الواحدة. */
const HANDLED_LAUNCH_URL_KEY = 'pospay.native.launchUrl';

interface CapacitorAppModule {
  App: {
    getLaunchUrl(): Promise<{ url?: string } | undefined>;
    addListener(
      eventName: 'appUrlOpen',
      listenerFunc: (event: { url: string }) => void,
    ): Promise<{ remove(): Promise<void> }>;
  };
}

let capacitorAppModule: Promise<CapacitorAppModule> | null = null;
// آخر لينك افتتاحي اتقرى ولسه ما اتقفلش: بنحتاجه لو تبديل اتأكد أو لينك تاني نجح من غير ما يمرّره.
let pendingLaunchUrl: string | null = null;
let latestLaunchReadId = 0;

/** بيحمّل إضافة Capacitor مرة واحدة عند أول طلب عشان الاستدعاءات المتزامنة في StrictMode تشترك في نفس الوعد. */
function loadCapacitorApp(): Promise<CapacitorAppModule> {
  if (capacitorAppModule === null) {
    // الاستيراد هنا مش في أعلى الملف: نسخة الويب ما تتحملش إضافة Capacitor في حزمتها (FR-005).
    capacitorAppModule = import('@capacitor/app').catch((error: unknown) => {
      capacitorAppModule = null;
      throw error;
    });
  }
  return capacitorAppModule;
}

/**
 * بيقرأ اللينك اللي التطبيق اتفتح بيه أول مرة (تشغيل بارد) من غير ما يستهلكه قبل ما يتطبّق.
 *
 * القراءة نفسها ما بتسجّلش اللينك في التخزين، عشان لو <StrictMode> لغى أول محاولة أو التطبيق فشل مؤقتًا
 * تفضل المحاولة الجاية قادرة تقراه. التسجيل بيحصل بعدين عبر `markLaunchLinkHandled`.
 *
 * @returns اللينك، أو null لو مفيش لينك أو القراءة فشلت أو بصمة اللينك ده اتسجلت قبل كده
 */
export async function readLaunchLink(): Promise<string | null> {
  const readId = ++latestLaunchReadId;
  try {
    const { App } = await loadCapacitorApp();
    const launch = await App.getLaunchUrl();
    // نسخة الويب بترجع نص فاضي، فالنص الفاضي معناه مفيش لينك.
    const url = launch?.url ? launch.url : null;
    if (readId !== latestLaunchReadId) return null;
    if (url === null) {
      pendingLaunchUrl = null;
      return null;
    }
    if (readHandledLaunchFingerprint() === launchUrlFingerprint(url)) {
      pendingLaunchUrl = null;
      return null;
    }
    pendingLaunchUrl = url;
    return url;
  } catch {
    if (readId === latestLaunchReadId) pendingLaunchUrl = null;
    return null;
  }
}

/**
 * بيسجل بصمة اللينك بعد ما الشاشة تتعامل معاه بنجاح، عشان إعادة تحميل الـ WebView ما تعيدهوش تاني.
 *
 * لو ما اتبعتش عنوان، بيقفل آخر لينك افتتاحي معروض، عشان تأكيد أو إلغاء التبديل أو نجاح لينك أحدث
 * ما يسيبوش اللينك القديم يتعاد عند إعادة التشغيل.
 *
 * @param url اللينك اللي اتطبّق (اختياري، والافتراضي آخر لينك افتتاحي معروض)
 */
export function markLaunchLinkHandled(url?: string): void {
  const target = url ?? pendingLaunchUrl;
  if (target === null) return;
  if (pendingLaunchUrl === target) pendingLaunchUrl = null;
  try {
    // بنحفظ البصمة بس ومش العنوان نفسه، عشان أي بارامترات أو أجزاء زيادة ما تفضلش في التخزين المؤقت.
    window.sessionStorage.setItem(HANDLED_LAUNCH_URL_KEY, launchUrlFingerprint(target));
  } catch {
    // من غير تخزين مفيش تكرار يمنع، بس الخطأ ما بيوقّفش التطبيق.
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
  const registration = loadCapacitorApp()
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

/** بصمة اللينك اللي اتعامل معاه في العملية دي، أو null لو مفيش ولا التخزين مقفول. */
function readHandledLaunchFingerprint(): string | null {
  try {
    return window.sessionStorage.getItem(HANDLED_LAUNCH_URL_KEY);
  } catch {
    // WebView مقيد بيمنع التخزين: كل قراءة بتعتبر أول مرة.
    return null;
  }
}

/** بصمة ثابتة للينك: تمنع حفظ العنوان الأصلي بالبارامترات بتاعته في sessionStorage. */
function launchUrlFingerprint(url: string): string {
  let low = 0x811c9dc5;
  let high = 0x9e3779b9;
  for (let index = 0; index < url.length; index += 1) {
    const code = url.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ (code + index), 0x85ebca6b);
  }
  const left = (high >>> 0).toString(16).padStart(8, '0');
  const right = (low >>> 0).toString(16).padStart(8, '0');
  return `fp:${left}${right}:${url.length.toString(16)}`;
}
