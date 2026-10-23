import { App } from '@capacitor/app';

/**
 * بيقرأ اللينك اللي التطبيق اتفتح بيه أول مرة (تشغيل بارد).
 *
 * @returns اللينك، أو null لو مفيش لينك أو القراءة فشلت
 */
export async function readLaunchLink(): Promise<string | null> {
  try {
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
  const handle = App.addListener('appUrlOpen', (event) => listener(event.url));
  return () => {
    void handle.then((registered) => registered.remove()).catch(() => undefined);
  };
}
