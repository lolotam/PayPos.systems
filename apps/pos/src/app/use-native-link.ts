import { useEffect } from 'react';

import { onLinkOpened, readLaunchLink } from '@/shared/platform/launch-links';

import { readDeviceRole, readRememberedBusiness, type DeviceRole } from './device-role';
import { readManagerLink, type PersonalWorkspace } from './manager-link';

/**
 * بيقرا حالة الجهاز أول ما التطبيق يفتح، وبيسمع للينكات اللي بتتفتح والتطبيق شغال.
 *
 * القراءة الأولى بتجيب الدور والنشاط واللينك مع بعض، عشان الشاشة تفتح مرة واحدة بالحالة الصح.
 *
 * @param onStart بيتنادى لما التطبيق فتح من غير لينك
 * @param onLink بيتنادى بكل لينك (workspace=null معناه لينك مش مقبول)
 */
export function useNativeLink(
  onStart: (role: DeviceRole | null, business: PersonalWorkspace | null) => void,
  onLink: (workspace: PersonalWorkspace | null) => Promise<void>,
): void {
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const [role, business, link] = await Promise.all([
          readDeviceRole(),
          readRememberedBusiness(),
          readLaunchLink(),
        ]);
        if (cancelled) return;
        if (link === null) {
          onStart(role, business);
          return;
        }
        await onLink(readManagerLink(link));
      } catch {
        if (cancelled) return;
        // تخزين غير مقروء زي أول تشغيل: المستخدم بيختار تاني.
        onStart(null, null);
      }
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
