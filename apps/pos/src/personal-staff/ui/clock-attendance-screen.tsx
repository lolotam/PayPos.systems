import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { capabilities } from '@/shared/platform/native-shell';
import { WebOnlyNotice } from '@/shared/platform/web-only-notice';

import { ClockAttendanceBody } from './clock-attendance-body';

/**
 * شاشة الحضور: في نسخة التطبيق الأصلي من غير كاميرا مقفولة، المسح بيتم في نسخة الويب (MOB-T05).
 *
 * العنوان بيبقى ظاهر في الحالتين عشان الموظفة تفهم الشاشة دي، بس من غير كاميرا ولا زر مسح.
 */
export function ClockAttendanceScreen() {
  const locale = useLocale();
  if (!capabilities().attendanceCamera) {
    return (
      <section className="grid gap-4" aria-label={t(locale, 'personalAttendance.title')}>
        <h2 className="text-xl font-semibold">{t(locale, 'personalAttendance.title')}</h2>
        <WebOnlyNotice path="/personal" />
      </section>
    );
  }
  return <ClockAttendanceBody />;
}
