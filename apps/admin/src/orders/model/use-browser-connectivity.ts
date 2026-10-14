'use client';
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

// null = لسه ما اتقريتش (رندر السيرفر والـ hydration)؛ الشاشة بتعاملها كأنها مش متصلة عشان مفيش قراءة أو كتابة
// تبدأ قبل ما حالة المتصفح الحقيقية تتعرف.
export function useBrowserConnectivity(): boolean | null {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => null);
}
