/**
 * بيقرأ اللينك اللي التطبيق اتفتح بيه أول مرة (تشغيل بارد).
 *
 * @returns اللينك، أو null لو مفيش لينك أو القراءة فشلت
 */
export async function readLaunchLink(): Promise<string | null> {
  try {
    // الاستيراد هنا مش في أعلى الملف: نسخة الويب ما تتحملش إضافة Capacitor في حزمتها (FR-005).
    const { App } = await import('@capacitor/app');
    const launch = await App.getLaunchUrl();
    // نسخة الويب بترجع نص فاضي، فالنص الفاضي معناه مفيش لينك.
    return launch?.url ? launch.url : null;
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
