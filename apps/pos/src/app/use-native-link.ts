import { useEffect } from 'react';

import { onLinkOpened, readLaunchLink } from '@/shared/platform/launch-links';

import { readDeviceRole, readRememberedBusiness, type DeviceRole } from './device-role';
import type { KnownShellState } from './link-rules';
import { readManagerLink, type PersonalWorkspace } from './manager-link';

/**
 * بيقرا حالة الجهاز أول ما التطبيق يفتح، وبيسمع للينكات اللي بتتفتح والتطبيق شغال.
 *
 * القراءة الأولى بتجيب الدور والنشاط واللينك مع بعض، عشان الشاشة تفتح مرة واحدة بالحالة الصح.
 * كل قراءة لوحدها، فاللي يفشل ما بيأثرش على اللي نجح: الشاشة بتفتح باللي معروف، والتنبيه
 * بيقول إن القراءة فشلت (FR-012).
 *
 * @param onStart بيتنادى لما التطبيق فتح من غير لينك
 * @param onLink بيتنادى بكل لينك (workspace=null معناه لينك مش مقبول)
 */
export function useNativeLink(
  onStart: (
    role: DeviceRole | null,
    business: PersonalWorkspace | null,
    readFailed?: boolean,
  ) => void,
  onLink: (workspace: PersonalWorkspace | null, fallback?: KnownShellState) => Promise<void>,
): void {
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const [roleResult, businessResult, linkResult] = await Promise.allSettled([
        Promise.resolve().then(() => readDeviceRole()),
        Promise.resolve().then(() => readRememberedBusiness()),
        Promise.resolve().then(() => readLaunchLink()),
      ]);
      if (cancelled) return;
      const role = roleResult.status === 'fulfilled' ? roleResult.value : null;
      const business = businessResult.status === 'fulfilled' ? businessResult.value : null;
      const link = linkResult.status === 'fulfilled' ? linkResult.value : null;
      // تخزين غير مقروء زي أول تشغيل: اللي اتقري معروف، واللي فات معروف إنه فشل.
      const storageFailed =
        roleResult.status === 'rejected' || businessResult.status === 'rejected';
      const readFailed = storageFailed || linkResult.status === 'rejected';
      if (link === null) {
        onStart(role, business, readFailed);
        return;
      }
      // لينك فوق تخزين ناقص: ما نطبّقش اللينك، عشان نشاط متذكر صحيح ما يضيعش.
      if (storageFailed) {
        onStart(role, business, true);
        return;
      }
      await onLink(readManagerLink(link), { role, business });
    };
    void start();
    return () => {
      cancelled = true;
    };
  }, [onStart, onLink]);

  useEffect(
    () =>
      onLinkOpened((raw) => {
        void onLink(readManagerLink(raw));
      }),
    [onLink],
  );
}
