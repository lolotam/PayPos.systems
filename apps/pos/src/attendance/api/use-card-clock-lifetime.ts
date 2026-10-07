import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

// نماذج الاستقبال مؤقتة؛ إبطال جلسة العامل أو انقطاع الشبكة يلغي الطلب ويمسح الاعتماد والنتيجة.
export function useCardClockLifetime(clear: () => void, setOnline: (online: boolean) => void) {
  const cache = useQueryClient();
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => {
      setOnline(false);
      clear();
    };
    const unsubscribe = cache.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== 'staff-session') return;
      if (event.type === 'removed' || (event.type === 'updated' && event.query.state.data === null))
        clear();
    });
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      clear();
      unsubscribe();
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [cache, clear, setOnline]);
}
