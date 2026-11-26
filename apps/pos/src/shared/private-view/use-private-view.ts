import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PrivateViewController } from './controller';
import type { PinProblem } from './state';

/** حالة النافذة من غير بياناتها: اللي الشاشة الدائمة (اللي فيها خطوة الـ PIN) بتشترك فيه. */
export type PrivateViewShell =
  | { phase: 'pin'; problem: PinProblem; epoch: number; waiting: boolean }
  | { phase: 'opening'; epoch: number }
  | { phase: 'leave' }
  | { readonly phase: 'open' };

const OPEN_SHELL = { phase: 'open' } as const;

/**
 * لقطة الهيكل: نفس حالة المتحكم لكن النافذة المفتوحة بتبقى كائن ثابت من غير بيانات الشاشة.
 * React بيحتفظ بآخر لقطة قراها المكوّن الدائم حتى بعد ما يرسم خطوة الـ PIN، فاللقطة دي لازم تبقى خالية من البيانات.
 *
 * @param controller متحكم النافذة
 * @returns دالة اللقطة لـ useSyncExternalStore
 */
export const windowShell =
  <TData, TAction>(controller: PrivateViewController<TData, TAction>): (() => PrivateViewShell) =>
  () => {
    const state = controller.getState();
    return state.phase === 'open' ? OPEN_SHELL : state;
  };

/**
 * بيانات النافذة المفتوحة للمكوّن اللي بيعرضها بس؛ المكوّن ده بيتفك مع القفل فاللقطة بتروح معاه.
 *
 * @param controller متحكم النافذة
 * @returns بيانات الشاشة، أو null لو النافذة مش مفتوحة
 */
export function usePrivateViewData<TData, TAction>(
  controller: PrivateViewController<TData, TAction>,
): TData | null {
  return useSyncExternalStore(controller.subscribe, () => {
    const state = controller.getState();
    return state.phase === 'open' ? state.data : null;
  });
}

/**
 * نافذة العرض الخاص على جهاز الاستقبال: بتركّب قبل إدخال الـ PIN وبتملك كل حاجة (فتح، قراءات، لمس، قفل).
 * «أي خروج من الواجهة يقفل النافذة ويطلب الرقم السري»؛ التفاصيل في المتحكم. الحالة بتتقرا من المتحكم بس
 * ومفيش كاش ولا تخزين؛ ولقطة المتجر نفسها بتبقى خطوة PIN بعد موعد القفل حتى لو المؤقت لسه ما اشتغلش.
 *
 * @param controller متحكم النافذة (لكل شاشة الشكل بتاعها)
 * @returns هيكل الحالة من غير بيانات، والمتحكم للمكوّن اللي بيعرض البيانات، وحاوية العرض الخاص (attachRoot)، وأفعال الفتح وإعادة القراءة
 */
export function usePrivateView<TData, TAction>(controller: PrivateViewController<TData, TAction>) {
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
    restartReads: useCallback((action: TAction) => controller.restartReads(action), [controller]),
  };
}
