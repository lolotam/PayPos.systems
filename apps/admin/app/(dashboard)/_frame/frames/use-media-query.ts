'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** نتيجة media query في المتصفح؛ على الخادم وحيث لا توجد matchMedia تكون false فيرسم الإطار وضع الحاسوب. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', callback);
      return () => media.removeEventListener('change', callback);
    },
    [query],
  );
  const read = useCallback(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    [query],
  );
  return useSyncExternalStore(subscribe, read, () => false);
}
