import { useEffect, useState } from 'react';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import type { WorkContext } from '../model/work-context';
import { PersonalWork } from './personal-work';
import { ReceptionWork } from './reception-work';

/**
 * شاشة «شغلي»: جهاز الاستقبال بيدخل بالـ PIN عن طريق متحكم النافذة، وموبايلها الشخصي على طول. من غير إنترنت مفيش بيانات
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
        context.mode === 'reception' ? (
          <ReceptionWork onLeave={onLeave} estimateAllowed={estimateAllowed} />
        ) : (
          <PersonalWork context={context} onLeave={onLeave} estimateAllowed={estimateAllowed} />
        )
      ) : (
        <p role="status">{t(locale, 'myWork.offline')}</p>
      )}
    </section>
  );
}
