import { useCallback, useRef, useState } from 'react';
import { defaultCalls, defaultEnv } from '@/private-view/env';
import { usePrivateView } from '@/private-view/use-private-view';
import { AttendanceWindowController } from './attendance-window-controller';

/**
 * نافذة «حضوري» الخاصة على جهاز الاستقبال: بتتركّب قبل إدخال الـ PIN وبيتملك كل حاجة (فتح، قراءات، لمس، قفل).
 * «أي خروج من الواجهة يقفل النافذة ويطلب الرقم السري»؛ التفاصيل في المتحكم المشترك.
 *
 * @param options.onLeave بتتنده لما الجلسة تتقفل (401)
 * @returns هيكل الحالة من غير بيانات، والمتحكم للمكوّن اللي بيعرض البيانات، وحاوية العرض الخاص، وأفعال الفتح والشهر وإعادة المحاولة
 */
export function useAttendanceWindow({ onLeave }: { onLeave: () => void }) {
  const leave = useRef(onLeave);
  leave.current = onLeave;
  const [controller] = useState(
    () =>
      new AttendanceWindowController(
        { env: defaultEnv, calls: defaultCalls },
        () => leave.current(),
      ),
  );
  const view = usePrivateView(controller);
  return {
    ...view,
    controller,
    stepMonth: useCallback((month: string | undefined) => controller.stepMonth(month), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
  };
}
