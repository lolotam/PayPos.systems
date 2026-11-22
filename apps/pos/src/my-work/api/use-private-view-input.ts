import { useEffect, useRef } from 'react';
import {
  type ClockHandlers,
  type ConfirmedWindow,
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
 */
export function usePrivateViewInput(
  confirmed: ConfirmedWindow | undefined,
  handlers: ClockHandlers,
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (confirmed === undefined) return;
    return startPrivateViewClock(confirmed, {
      hide: () => latest.current.hide(),
      show: () => latest.current.show(),
      close: (scope) => latest.current.close(scope),
      refused: (error) => latest.current.refused(error),
    });
  }, [confirmed]);
}
