import { t } from '@pospay/i18n';
import { useEffect, useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import type { AttendanceContext } from '../model/attendance-context';
import { PersonalAttendance } from './personal-attendance';
import { ReceptionAttendance } from './reception-attendance';

/**
 * شاشة «حضوري»: جهاز الاستقبال بيدخل بالـ PIN عن طريق متحكم النافذة، وموبايلها الشخصي على طول.
 * من غير إنترنت مفيش بيانات ولا بنحفظ منها حاجة محلياً (FR-A09).
 *
 * @param props.context مين بيفتح الشاشة وهويتها
 * @param props.onLeave بتتنده لما الجلسة تتقفل (401) والشاشة الخاصة تتقفل كلها
 * @param props.timeZone توقيت النشاط؛ على جهاز الاستقبال ده توقيت فرع الجهاز
 */
export function AttendanceScreen({
  context,
  onLeave,
  timeZone,
}: {
  context: AttendanceContext;
  onLeave: () => void;
  timeZone: string | undefined;
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
      aria-label={t(locale, 'myAttendance.title')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="grid gap-4"
    >
      <h2>{t(locale, 'myAttendance.title')}</h2>
      {online ? (
        context.mode === 'reception' ? (
          <ReceptionAttendance onLeave={onLeave} timeZone={timeZone} />
        ) : (
          <PersonalAttendance context={context} onLeave={onLeave} />
        )
      ) : (
        <p role="status">{t(locale, 'myAttendance.offline')}</p>
      )}
    </section>
  );
}
