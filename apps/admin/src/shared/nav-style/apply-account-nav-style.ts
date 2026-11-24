import { myPreferencesResponse, type NavStyle } from '@pospay/contracts';

import { apiClient } from '@/shared/api/client';
import { announceIdentityChange } from '@/shared/browser/load-page';

import { clearNavStyleCookie, writeNavStyleCookie } from './nav-style-cookie';
import { stopNavStyleSaving } from './nav-style-stop';

async function readStyle(signal: AbortSignal): Promise<NavStyle | null> {
  try {
    const { data, error, response } = await apiClient().GET('/v1/me/preferences', {
      cache: 'no-store',
      signal,
    });
    if (error !== undefined || !response.ok) return null;
    const parsed = myPreferencesResponse.safeParse(data);
    return parsed.success ? parsed.data.navStyle : null;
  } catch {
    return null;
  }
}

/**
 * الترتيب مقصود: إيقاف حفظ هذا التبويب، ثم مسح الكوكي فورًا عشان ما حدا يرسم نمط المستخدم السابق،
 * ثم إعلان التبويبات التانية، ثم القراءة المحدودة. الكوكي يتكتب مرة واحدة فقط إذا رجعت قيمة صحيحة؛
 * حد واحد يشمل النقل وفك الجسم والنتيجة المتأخرة لا تكتب الكوكي بعد انتهاء الدخول.
 */
export async function applyAccountNavStyle(): Promise<void> {
  stopNavStyleSaving();
  clearNavStyleCookie();
  announceIdentityChange();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        resolve(null);
        controller.abort();
      }, 2000);
    });
    const style = await Promise.race([readStyle(controller.signal), deadline]);
    if (style !== null) writeNavStyleCookie(style);
  } finally {
    clearTimeout(timer);
  }
}
