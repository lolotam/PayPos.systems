import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PrivateWindowController } from './private-window-controller';
import { defaultCalls, defaultEnv, type PrivateWindowDeps } from './private-window-env';

export type PrivateWindowOptions = {
  /** بتتنده لما الجلسة نفسها تتقفل (401) والشاشة الخاصة لازم تتقفل كلها. */
  onLeave: () => void;
  /** ساعات ومؤقتات واستدعاءات مزيفة للاختبار؛ الافتراضي الحقيقي. */
  deps?: Partial<PrivateWindowDeps>;
};

/**
 * نافذة العرض الخاص على جهاز الاستقبال: بيتركّب قبل إدخال الـ PIN ويملك كل حاجة (فتح، قراءات، لمس،
 * قفل). «أي خروج من الواجهة يقفل النافذة ويطلب الرقم السري»؛ التفاصيل في المتحكم. الحالة بتتقرا من
 * المتحكم بس ومفيش كاش ولا تخزين؛ والشاشة ما بتعرضش حاجة بعد موعد القفل حتى لو المؤقت لسه ما اشتغلش.
 *
 * @param options.onLeave بتتنده لما الجلسة تتقفل
 * @param options.deps حقن الساعات والاستدعاءات للاختبار
 * @returns الحالة المعروضة وأفعال الفتح والشهر والمزيد وإعادة المحاولة
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
  useEffect(() => controller.start(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return {
    state: controller.visible(state),
    submitPin: useCallback((pin: string) => controller.submitPin(pin), [controller]),
    stepMonth: useCallback((month: string) => controller.stepMonth(month), [controller]),
    loadMore: useCallback(() => controller.loadMore(), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
  };
}
