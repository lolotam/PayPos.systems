import { useCallback, useEffect, useRef } from 'react';
import {
  type ClockHandlers,
  type ConfirmedWindow,
  type PrivateViewClockHandle,
  startPrivateViewClock,
} from './private-view-clock';

export { PRIVATE_VIEW_TOUCH_MS, monotonicNow, wallNow } from './private-view-clock';
export type { ConfirmedWindow } from './private-view-clock';

/**
 * بيربط ساعة النافذة المفتوحة (`private-view-clock`) بدورة حياة الشاشة. الرد على الساعة بيتقرا
 * من آخر نسخة، فتغيّر الدوال مبيعيدش تشغيل الساعة ومبيصفّرش مواعيدها.
 *
 * @param confirmed النافذة المفتوحة ومواعيدها، أو undefined لو مفيش نافذة (الساعة واقفة)
 * @param handlers ردود الفعل: إخفاء، إظهار، قفل بنطاقه، ورفض السيرفر
 * @returns سياج النافذة الحالية: `epoch` رقم دورة الظهور وقت إرسال القراءة، و`fence` بيقفل لو النافذة
 *   مش الحالية وبيقول لأ لو الدورة مش متحقَّق منها أو اتغيّرت (ومن غير ساعة شغالة بيقول لأ فأي رد
 *   يترمي)، و`isCurrent` بيفحص من غير قفل
 */
export function usePrivateViewInput(
  confirmed: ConfirmedWindow | undefined,
  handlers: ClockHandlers,
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  const running = useRef<PrivateViewClockHandle | undefined>(undefined);
  useEffect(() => {
    if (confirmed === undefined) return;
    const clock = startPrivateViewClock(confirmed, {
      hide: () => latest.current.hide(),
      show: () => latest.current.show(),
      close: (scope) => latest.current.close(scope),
      refused: (error) => latest.current.refused(error),
    });
    running.current = clock;
    return () => {
      clock.stop();
      if (running.current === clock) running.current = undefined;
    };
  }, [confirmed]);
  // أول قراءة بعد الفتح ممكن تتبعت قبل ما تأثير الساعة يشتغل: وقتها الدورة هي الصفر.
  const epoch = useCallback(() => running.current?.epoch() ?? 0, []);
  const fence = useCallback(
    (windowId: string, readEpoch: number) => running.current?.fence(windowId, readEpoch) ?? false,
    [],
  );
  // أول رسم بعد الفتح بييجي قبل ما تأثير الساعة يشتغل: وقتها النافذة المؤكَّدة هي الحالية.
  const isCurrent = useCallback(
    (windowId: string) =>
      running.current ? running.current.isCurrent(windowId) : windowId === confirmed?.windowId,
    [confirmed],
  );
  return { epoch, fence, isCurrent };
}
