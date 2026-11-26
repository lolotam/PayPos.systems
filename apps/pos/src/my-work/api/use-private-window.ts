import { useCallback, useRef, useState } from 'react';
import { usePrivateView, windowShell } from '@/private-view/use-private-view';
import { PrivateWindowController } from './private-window-controller';
import { defaultCalls, defaultEnv, type PrivateWindowDeps } from './private-window-env';

export { windowShell };

export type PrivateWindowOptions = {
  /** بتتنده لما الجلسة نفسها تتقفل (401) والشاشة الخاصة لازم تتقفل كلها. */
  onLeave: () => void;
  /** ساعات ومؤقتات واستدعاءات مزيفة للاختبار؛ الافتراضي الحقيقي. */
  deps?: Partial<PrivateWindowDeps>;
};

/**
 * نافذة العرض الخاص على جهاز الاستقبال: بيتركّب قبل إدخال الـ PIN ويملك كل حاجة (فتح، قراءات، لمس،
 * قفل). «أي خروج من الواجهة يقفل النافذة ويطلب الرقم السري»؛ التفاصيل في المتحكم. الحالة بتتقرا من
 * المتحكم بس ومفيش كاش ولا تخزين؛ ولقطة المتجر نفسها بتبقى خطوة PIN بعد موعد القفل حتى لو المؤقت لسه ما اشتغلش.
 *
 * @param options.onLeave بتتنده لما الجلسة تتقفل
 * @param options.deps حقن الساعات والاستدعاءات للاختبار
 * @returns هيكل الحالة من غير بيانات، والمتحكم للمكوّن اللي بيعرض البيانات، وحاوية العرض الخاص (attachRoot)، وأفعال الفتح والشهر والمزيد وإعادة المحاولة
 */
export function usePrivateWindow({ onLeave, deps }: PrivateWindowOptions) {
  const leave = useRef(onLeave);
  leave.current = onLeave;
  const [controller] = useState(
    () =>
      new PrivateWindowController(
        { env: deps?.env ?? defaultEnv, calls: deps?.calls ?? defaultCalls },
        () => leave.current(),
      ),
  );
  const view = usePrivateView(controller);
  return {
    ...view,
    controller,
    stepMonth: useCallback((month: string | undefined) => controller.stepMonth(month), [controller]),
    loadMore: useCallback(() => controller.loadMore(), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
    retryTips: useCallback(() => controller.retryTips(), [controller]),
  };
}
