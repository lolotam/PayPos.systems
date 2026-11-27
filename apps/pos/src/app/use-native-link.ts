import { useEffect } from 'react';

import {
  markLaunchLinkHandled,
  onLinkOpened,
  readLaunchLink,
} from '@/shared/platform/launch-links';

import { readDeviceRole, readRememberedBusiness, type DeviceRole } from './device-role';
import type { KnownShellState } from './link-rules';
import { readManagerLink, type PersonalWorkspace } from './manager-link';

/**
 * بيقرا حالة الجهاز أول ما التطبيق يفتح، وبيسمع للينكات اللي بتتفتح والتطبيق شغال.
 *
 * القراءة الأولى بتجيب الدور والنشاط واللينك مع بعض، عشان الشاشة تفتح مرة واحدة بالحالة الصح.
 * كل قراءة لوحدها، فاللي يفشل ما بيأثرش على اللي نجح: الشاشة بتفتح باللي معروف، والتنبيه
 * بيقول إن القراءة فشلت (FR-012). بصمة اللينك بتتسجل بس بعد ما يتطبّق، عشان الإلغاء أو
 * الفشل المؤقت ما يضيعوش اللينك.
 *
 * @param onStart بيتنادى لما التطبيق فتح من غير لينك أو القراءة فشلت
 * @param onLink  بيتنادى بكل لينك ويرجع true لو اللينك اتطبّق ومش محتاج إعادة
 */
export function useNativeLink(
  onStart: (
    role: DeviceRole | null,
    business: PersonalWorkspace | null,
    readFailed?: boolean,
    businessUnreadable?: boolean,
  ) => void,
  onLink: (workspace: PersonalWorkspace | null, fallback?: KnownShellState) => Promise<boolean>,
): void {
  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const [roleResult, businessResult, link] = await Promise.all([
        Promise.resolve()
          .then(() => readDeviceRole())
          .then(
            (value) => ({ status: 'fulfilled' as const, value }),
            () => ({ status: 'rejected' as const }),
          ),
        Promise.resolve()
          .then(() => readRememberedBusiness())
          .then(
            (value) => ({ status: 'fulfilled' as const, value }),
            () => ({ status: 'rejected' as const }),
          ),
        readLaunchLink(),
      ]);
      if (cancelled) return;
      const role = roleResult.status === 'fulfilled' ? roleResult.value : null;
      const business = businessResult.status === 'fulfilled' ? businessResult.value : null;
      const businessUnreadable = businessResult.status === 'rejected';
      // تخزين غير مقروء زي أول تشغيل: اللي اتقري معروف، واللي فات معروف إنه فشل.
      const storageFailed = roleResult.status === 'rejected' || businessUnreadable;
      if (link === null) {
        onStart(role, business, storageFailed, businessUnreadable);
        return;
      }
      // لينك فوق تخزين ناقص: ما نطبّقش اللينك وما نستهلكوش، عشان نشاط متذكر صحيح ما يضيعش.
      if (storageFailed) {
        onStart(role, business, true, businessUnreadable);
        return;
      }
      const handled = await onLink(readManagerLink(link), { role, business });
      if (!cancelled && handled) markLaunchLinkHandled(link);
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
