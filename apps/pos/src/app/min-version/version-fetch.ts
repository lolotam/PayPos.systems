import { appVersionManifestSchema } from '@pospay/contracts';

import { nativeFlavour, nativePosHost } from '@/shared/platform/native-shell';

import { isVersionBelowMinimum, parseAppVersion } from './version-compare';

/**
 * نتيجة الفحص: التطبيق محتاج تحديث، ولا لأ.
 *
 * `blocked` معناها إن في حد أدنى أعلى من الإصدار المثبّت، والـ storeUrl هو لينك المتجر
 * اللي بتتعرض منه (بعد ما يعدّي فلتر المضيفين).
 */
export type MinVersionStatus = { outcome: 'blocked'; storeUrl: string } | { outcome: 'ok' };

/**
 * بيجيب ملف النسخة من الـ host ويقارنه بالإصدار المثبّت.
 *
 * القراءة بتتم من خلال HTTP الأصلي (`CapacitorHttp`) مش `fetch` جوه الـ web view،
 * لأن القراءة من `capacitor://localhost` كانت هتحتاج CORS (FR-003). أي فشل — نت،
 * مهلة، ملف مش موجود، أو ملف مش مفهوم — بيرجّع null، والتطبيق بيفتح عادي (FR-007).
 *
 * @returns نتيجة الفحص، أو null لو الملف مش مقروء
 */
export async function fetchMinVersionStatus(): Promise<MinVersionStatus | null> {
  try {
    // الاستيراد هنا مش في أعلى الملف: نسخة الويب ما تتحملش إضافة Capacitor في حزمتها (FR-005).
    const { App } = await import('@capacitor/app');
    const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
    const info = await App.getInfo();
    const installed = parseAppVersion(info.version);
    // إصدار التطبيق نفسه مش مقروء: مش هنمنع التشغيل (FR-007).
    if (installed === null) return null;
    const response = await CapacitorHttp.get({
      url: `https://${nativePosHost()}/app-version/${nativeFlavour()}.json`,
      connectTimeout: 10000,
      readTimeout: 10000,
      responseType: 'text',
    });
    if (response.status !== 200) return null;
    const manifest = appVersionManifestSchema.safeParse(readManifest(response.data));
    if (!manifest.success) return null;
    // المنصة اللي التطبيق شغال عليها: كل واحدة ليها مدخل مستقل (SC-004).
    const platform = Capacitor.getPlatform() === 'ios' ? manifest.data.ios : manifest.data.android;
    if (!isVersionBelowMinimum(info.version, platform.minimum)) return { outcome: 'ok' };
    return { outcome: 'blocked', storeUrl: platform.store_url };
  } catch {
    return null;
  }
}

/**
 * Capacitor بيرجّع نص JSON أو كائن جاهز حسب المحتوى، فبنقبل الاتنين (FR-003).
 *
 * @param data جسم الردّ زي ما رجع من CapacitorHttp
 * @returns جسم قابل للتحليل، أو null لو مش JSON
 */
function readManifest(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * بيسمع لحالة التطبيق: قدام ولا ورا (FR-001).
 *
 * @param listener بيتنادى بـ true قدام وfalse ورا
 * @returns دالة بيشيل بيها الاستماع
 */
export function onAppStateChange(listener: (isActive: boolean) => void): () => void {
  let removed = false;
  // نفس سبب القراءة فوق: الإضافة الأصلية ما بتوصلش لحزمة نسخة الويب (FR-005).
  const registration = import('@capacitor/app')
    .then(({ App }) => {
      // الدالة اللي بتشيل الاستماع ممكن تتنادى قبل ما الإضافة تتحمل، فمفيش تسجيل أصلاً.
      if (removed) return null;
      return App.addListener('appStateChange', ({ isActive }) => listener(isActive));
    })
    .catch(() => null);
  return () => {
    removed = true;
    void registration
      .then((handle) => (handle === null ? undefined : handle.remove()))
      .catch(() => undefined);
  };
}
