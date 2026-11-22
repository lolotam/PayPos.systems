import { useLayoutEffect } from 'react';

/** صلة الصفحة بالشاشة الضامّة: دالة تضع معالج الإنشاء (أو تسحبه)، وهل هذا العرض هو الظاهر الآن (المحمول المخفي لا يسجّل). */
export type CreateEmbed = {
  setHandler: (run: (() => void) | null) => void;
  active: boolean;
};

/**
 * يضع معالج الإنشاء عند الشاشة طالما العرض ظاهرًا ويسحبه عند إخفائه أو فكّه؛
 * ولا يفعل شيئًا حين لا تكون الصفحة مضمَّنة في شاشة (تعرض ترويستها بنفسها).
 * الشاشة تقرر ظهور الزر وتعطيله من حالتها هي في الرندر نفسه، فلا يتأخر الزر عن أول رسم؛
 * والتسجيل هنا هوية المعالج فقط، ويتم قبل الرسم (layout effect) فلا توجد لحظة يظهر فيها زر بلا معالج.
 *
 * @param embed صلة الشاشة الضامّة، أو undefined للصفحة المستقلة
 * @param run   بدء الإنشاء في العرض
 */
export function useRegisterCreateAction(embed: CreateEmbed | undefined, run: () => void) {
  const setHandler = embed?.setHandler;
  const active = embed?.active === true;
  useLayoutEffect(() => {
    if (!setHandler || !active) return;
    setHandler(run);
    return () => setHandler(null);
  });
}
