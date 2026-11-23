import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PrivateWindowController } from './private-window-controller';
import { defaultCalls, defaultEnv, type PrivateWindowDeps } from './private-window-env';
import type { PrivateWindowState, WorkData } from '../model/private-window-state';

export type PrivateWindowOptions = {
  /** بتتنده لما الجلسة نفسها تتقفل (401) والشاشة الخاصة لازم تتقفل كلها. */
  onLeave: () => void;
  /** ساعات ومؤقتات واستدعاءات مزيفة للاختبار؛ الافتراضي الحقيقي. */
  deps?: Partial<PrivateWindowDeps>;
};

/** حالة النافذة من غير بياناتها: اللي الشاشة الدائمة (اللي فيها خطوة الـ PIN) بتشترك فيه. */
export type PrivateWindowShell =
  Exclude<PrivateWindowState, { phase: 'open' }> | { readonly phase: 'open' };

const OPEN_SHELL = { phase: 'open' } as const;

/**
 * لقطة الهيكل: نفس حالة المتحكم لكن النافذة المفتوحة بتبقى كائن ثابت من غير صفحات ولا إكراميات ولا رقم نافذة.
 * React بيحتفظ بآخر لقطة قراها المكوّن الدائم حتى بعد ما يرسم خطوة الـ PIN، فاللقطة دي لازم تبقى خالية من البيانات.
 *
 * @param controller متحكم النافذة
 * @returns دالة اللقطة لـ useSyncExternalStore
 */
export const windowShell = (controller: PrivateWindowController) => (): PrivateWindowShell => {
  const state = controller.getState();
  return state.phase === 'open' ? OPEN_SHELL : state;
};

/**
 * بيانات النافذة المفتوحة للمكوّن اللي بيعرضها بس؛ المكوّن ده بيتفك مع القفل فاللقطة بتروح معاه.
 *
 * @param controller متحكم النافذة
 * @returns بيانات الشاشة، أو null لو النافذة مش مفتوحة
 */
export function usePrivateWindowData(controller: PrivateWindowController): WorkData | null {
  return useSyncExternalStore(controller.subscribe, () => {
    const state = controller.getState();
    return state.phase === 'open' ? state.data : null;
  });
}

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
  useEffect(() => controller.start(), [controller]);
  const [shell] = useState(() => windowShell(controller));
  const state = useSyncExternalStore(controller.subscribe, shell);
  return {
    state,
    controller,
    attachRoot: controller.attachRoot,
    submitPin: useCallback(
      (pin: string, epoch: number) => controller.submitPin(pin, epoch),
      [controller],
    ),
    stepMonth: useCallback(
      (month: string | undefined) => controller.stepMonth(month),
      [controller],
    ),
    loadMore: useCallback(() => controller.loadMore(), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
    retryTips: useCallback(() => controller.retryTips(), [controller]),
  };
}
