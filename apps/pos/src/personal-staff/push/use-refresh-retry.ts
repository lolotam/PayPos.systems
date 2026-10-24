import { useEffect } from 'react';

/**
 * إعادة محاولة التحديث اللي فشل: بتركّز الشاشة أو الشبكة تيجي أو المستخدم يرجع للتطبيق.
 * وبيجي معاها إعادة قراءة السجل عشان السماح المتغير في إعدادات المتصفح يتقرا (FR-010).
 *
 * @param retry  بيمسح علامة الفشل عشان التحديث يتعاد
 * @param reload بيقرأ السجل المحلي من جديد
 */
export function useRefreshRetry(retry: () => void, reload: () => Promise<void>): void {
  useEffect(() => {
    const again = () => {
      retry();
      void reload();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') again();
    };
    window.addEventListener('focus', again);
    window.addEventListener('online', again);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', again);
      window.removeEventListener('online', again);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload, retry]);
}
