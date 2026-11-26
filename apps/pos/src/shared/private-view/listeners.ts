const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/**
 * مستمعي الخروج من الواجهة والإدخال، بيتركّبوا من أول mount عشان أي خروج وقت الفتح يتشاف.
 * الخروج = إخفاء التاب، pagehide، freeze، resume، pageshow راجعة من الكاش، أو blur للنافذة؛ كلهم بيقفلوا. (blur العناصر مبيطلعش لمستمع غير الـ capture، فمفيش داعي لفحص الهدف.)
 *
 * الإدخال اللي بيتحسب هو اللي هدفه جوّا حاوية العرض الخاص بس: «شغلي» على جهاز الاستقبال جنب الحضور وموافقات الخصم،
 * فلمسة أو كتابة هناك مش استعمال لشاشتها وما بتمدّش وقت عرض بياناتها. (تمرير الصفحة نفسها هدفه المستند فمش بيتحسب؛ اللمس والعجلة جوّا الحاوية بيتحسبوا.)
 *
 * @param onBoundary بتتنده عند أي خروج
 * @param onInput بتتنده عند إدخال المستخدمة جوّا الحاوية (لمسة السيرفر وموعد الخمول)
 * @param root الحاوية المسجّلة حالياً، أو null لما مفيش نافذة مفتوحة
 * @returns دالة بتشيل كل المستمعين
 */
export function attachWindowListeners(
  onBoundary: () => void,
  onInput: () => void,
  root: () => HTMLElement | null,
): () => void {
  const input = (event: Event) => {
    const container = root();
    if (container !== null && event.target instanceof Node && container.contains(event.target))
      onInput();
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') onBoundary();
  };
  const pageshow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) onBoundary();
  };
  for (const name of INPUT_EVENTS)
    document.addEventListener(name, input, { capture: true, passive: true });
  document.addEventListener('visibilitychange', hidden);
  document.addEventListener('freeze', onBoundary);
  document.addEventListener('resume', onBoundary);
  window.addEventListener('pagehide', onBoundary);
  window.addEventListener('pageshow', pageshow);
  window.addEventListener('blur', onBoundary);
  return () => {
    for (const name of INPUT_EVENTS) document.removeEventListener(name, input, true);
    document.removeEventListener('visibilitychange', hidden);
    document.removeEventListener('freeze', onBoundary);
    document.removeEventListener('resume', onBoundary);
    window.removeEventListener('pagehide', onBoundary);
    window.removeEventListener('pageshow', pageshow);
    window.removeEventListener('blur', onBoundary);
  };
}
