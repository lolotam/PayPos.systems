const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/**
 * مستمعي الخروج من الواجهة والإدخال، بيتركّبوا من أول mount عشان أي خروج وقت الفتح يتشاف.
 * الخروج = إخفاء التاب، pagehide، freeze، resume، pageshow راجعة من الكاش، أو blur للنافذة؛ كلهم بيقفلوا. (blur العناصر مبيطلعش لمستمع غير الـ capture، فمفيش داعي لفحص الهدف.)
 *
 * @param onBoundary بتتنده عند أي خروج
 * @param onInput بتتنده عند إدخال المستخدمة (لمسة السيرفر)
 * @returns دالة بتشيل كل المستمعين
 */
export function attachWindowListeners(onBoundary: () => void, onInput: () => void): () => void {
  const hidden = () => {
    if (document.visibilityState === 'hidden') onBoundary();
  };
  const pageshow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) onBoundary();
  };
  for (const name of INPUT_EVENTS)
    document.addEventListener(name, onInput, { capture: true, passive: true });
  document.addEventListener('visibilitychange', hidden);
  document.addEventListener('freeze', onBoundary);
  document.addEventListener('resume', onBoundary);
  window.addEventListener('pagehide', onBoundary);
  window.addEventListener('pageshow', pageshow);
  window.addEventListener('blur', onBoundary);
  return () => {
    for (const name of INPUT_EVENTS) document.removeEventListener(name, onInput, true);
    document.removeEventListener('visibilitychange', hidden);
    document.removeEventListener('freeze', onBoundary);
    document.removeEventListener('resume', onBoundary);
    window.removeEventListener('pagehide', onBoundary);
    window.removeEventListener('pageshow', pageshow);
    window.removeEventListener('blur', onBoundary);
  };
}
