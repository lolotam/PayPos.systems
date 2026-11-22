import { useEffect } from 'react';
import { privateViewCalls } from './private-view-calls';

/** الخمول المسموح على جهاز الاستقبال قبل ما الشاشة ترجع لخطوة الـ PIN (D-A13). */
export const PRIVATE_VIEW_IDLE_MS = 60_000;
/** أقل فاصل بين لمستين للسيرفر. */
export const PRIVATE_VIEW_TOUCH_MS = 20_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/**
 * ساعة النافذة المفتوحة على جهاز الاستقبال: أي إدخال بيصفّر عدّاد الخمول ويبعت لمسة للسيرفر
 * (مرة كل 20 ثانية على الأكتر، والمتأخر بيتبعت بعد الفاصل)، وبعد 60 ثانية من غير إدخال بينده القفل.
 * مفيش مؤقت أعمى بيلمس السيرفر: اللمس بيتحرك بالإدخال بس.
 *
 * @param windowId رقم النافذة المفتوحة، أو undefined لو مفيش نافذة (الساعة واقفة)
 * @param onIdle بتتنده بعد 60 ثانية من غير إدخال
 * @param onRefused بتستلم رفض اللمس (انتهاء النافذة أو الجلسة)
 */
export function usePrivateViewInput(
  windowId: string | undefined,
  onIdle: () => void,
  onRefused: (error: unknown) => void,
) {
  useEffect(() => {
    if (windowId === undefined) return;
    let lastTouch = Date.now();
    let trailing: ReturnType<typeof setTimeout> | undefined;
    let idle = setTimeout(onIdle, PRIVATE_VIEW_IDLE_MS);
    const touch = () => {
      trailing = undefined;
      lastTouch = Date.now();
      privateViewCalls.touch(windowId).catch(onRefused);
    };
    const input = () => {
      clearTimeout(idle);
      idle = setTimeout(onIdle, PRIVATE_VIEW_IDLE_MS);
      const wait = lastTouch + PRIVATE_VIEW_TOUCH_MS - Date.now();
      if (wait <= 0) touch();
      else trailing ??= setTimeout(touch, wait);
    };
    for (const event of INPUT_EVENTS)
      document.addEventListener(event, input, { capture: true, passive: true });
    return () => {
      clearTimeout(idle);
      clearTimeout(trailing);
      for (const event of INPUT_EVENTS) document.removeEventListener(event, input, true);
    };
  }, [windowId, onIdle, onRefused]);
}
