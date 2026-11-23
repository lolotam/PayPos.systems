'use client';
import { useSyncExternalStore } from 'react';

const STACKED_QUERY = '(max-width: 599.99px)';

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia(STACKED_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function stackedNow() {
  return typeof window.matchMedia === 'function' && window.matchMedia(STACKED_QUERY).matches;
}

/**
 * هل الشاشة بعرض الصفوف المكدسة (تحت 600px)؟ الإطار يخفي ترويسة الجدول بصريًا هناك،
 * فتحتاج عناصرها التفاعلية إلى الخروج من ترتيب Tab بخاصية لا بصنف CSS. الخادم والمتصفح بلا matchMedia: خطأ.
 */
export function useStackedWidth(): boolean {
  return useSyncExternalStore(subscribe, stackedNow, () => false);
}
