'use client';
import { useSyncExternalStore } from 'react';

// نفس شرط Tailwind لـ max-[599.99px]: أصغر تمامًا من 599.99px، حتى لا يختلف الإطار عن الخاصية عند التساوي.
const STACKED_QUERY = '(width < 599.99px)';

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(STACKED_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** هل العرض الحالي مكدّس الآن؟ للأكواد خارج الرسم (مثل نقل التركيز لحظة الانتقال). */
export function isStackedWidth() {
  return typeof window.matchMedia === 'function' && window.matchMedia(STACKED_QUERY).matches;
}

/**
 * هل الشاشة بعرض الصفوف المكدسة (تحت 600px)؟ الإطار يخفي ترويسة الجدول بصريًا هناك،
 * فلا تُرسم فيها أزرار فرز. الخادم والمتصفح بلا matchMedia: خطأ.
 */
export function useStackedWidth(): boolean {
  return useSyncExternalStore(subscribe, isStackedWidth, () => false);
}
