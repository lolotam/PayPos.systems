import { useEffect, useState } from 'react';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { WorkContext } from '../model/work-context';
import { MyWorkCards } from './my-work-cards';
import { PrivateViewGate } from './private-view-gate';

/**
 * شاشة «شغلي»: بوابة الـ PIN على جهاز الاستقبال ثم خدمات الشهر. من غير إنترنت مفيش بيانات
 * ولا بنحفظ منها حاجة محلياً (FR-A09).
 *
 * @param props.context مين بيفتح الشاشة وهويته
 * @param props.onLeave بتتنده لما الجلسة تتقفل (401) والشاشة الخاصة تتقفل كلها
 * @param props.estimateAllowed هل كارت التقدير مسموح؛ الافتراضي false من كل مدخل إنتاج لحد 57-5 (AC-57-4-4 المعدّلة)
 */
export function MyWorkScreen({
  context,
  onLeave,
  estimateAllowed = false,
}: {
  context: WorkContext;
  onLeave: () => void;
  estimateAllowed?: boolean;
}) {
  const locale = useLocale();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <section
      aria-label={t(locale, 'myWork.title')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="grid gap-4"
    >
      <h2>{t(locale, 'myWork.title')}</h2>
      {online ? (
        <PrivateViewGate
          mode={context.mode}
          cachePrefix={['my-work', context.identity]}
          onLeave={onLeave}
        >
          {(access) => (
            <MyWorkCards context={context} access={access} estimateAllowed={estimateAllowed} />
          )}
        </PrivateViewGate>
      ) : (
        <p role="status">{t(locale, 'myWork.offline')}</p>
      )}
    </section>
  );
}
