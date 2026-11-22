import { useEffect } from 'react';
import {
  closeAt,
  touchedDeadlines,
  type PrivateViewDeadlines,
} from '../model/private-view-deadline';
import { privateViewCalls } from './private-view-calls';

/** أقل فاصل بين لمستين للسيرفر. */
export const PRIVATE_VIEW_TOUCH_MS = 20_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/** الساعة الرتيبة للتاب: المصدر الوحيد للوقت في النافذة، والاختبارات بتتحكم فيها بالمؤقتات المزيفة. */
export const monotonicNow = (): number => performance.now();

/** نافذة مفتوحة ومواعيدها اللي أكّدها السيرفر في رد الفتح. */
export type ConfirmedWindow = {
  windowId: string;
  deadlines: PrivateViewDeadlines;
};

/**
 * ساعة النافذة المفتوحة على جهاز الاستقبال. الشاشة بتتقفل في الأبكر بين موعد الخمول المؤكَّد من
 * السيرفر والسقف المطلق، بمؤقت في التاب نفسه مش بس عند أول 403. الإدخال بيطلب لمسة للسيرفر
 * (مرة كل 20 ثانية على الأكتر، والمتأخر بيتبعت بعد الفاصل) ومبيمددش حاجة بنفسه: الموعد بيتحرك
 * لما اللمسة تنجح بس وللقيمة اللي رجّعها السيرفر. اللمسة الفاشلة (شبكة أو رفض) ما بتمددش حاجة.
 *
 * @param confirmed النافذة المفتوحة ومواعيدها، أو undefined لو مفيش نافذة (الساعة واقفة)
 * @param onClose بتتنده في موعد القفل المؤكَّد
 * @param onRefused بتستلم رفض اللمس (انتهاء النافذة أو الجلسة)
 */
export function usePrivateViewInput(
  confirmed: ConfirmedWindow | undefined,
  onClose: () => void,
  onRefused: (error: unknown) => void,
) {
  useEffect(() => {
    if (confirmed === undefined) return;
    const { windowId } = confirmed;
    let deadlines = confirmed.deadlines;
    let live = true;
    let lastTouch = monotonicNow();
    let trailing: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(expiry);
      expiry = setTimeout(onClose, Math.max(0, closeAt(deadlines) - monotonicNow()));
    };
    const touch = () => {
      trailing = undefined;
      const sentAt = monotonicNow();
      lastTouch = sentAt;
      privateViewCalls.touch(windowId).then(
        (remaining) => {
          if (!live) return;
          deadlines = touchedDeadlines(deadlines, sentAt, remaining);
          arm();
        },
        (error: unknown) => {
          if (live) onRefused(error);
        },
      );
    };
    const input = () => {
      const wait = lastTouch + PRIVATE_VIEW_TOUCH_MS - monotonicNow();
      if (wait <= 0) touch();
      else trailing ??= setTimeout(touch, wait);
    };
    arm();
    for (const event of INPUT_EVENTS)
      document.addEventListener(event, input, { capture: true, passive: true });
    return () => {
      live = false;
      clearTimeout(expiry);
      clearTimeout(trailing);
      for (const event of INPUT_EVENTS) document.removeEventListener(event, input, true);
    };
  }, [confirmed, onClose, onRefused]);
}
