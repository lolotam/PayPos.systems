import { t } from '@pospay/i18n';
import { formatBusinessDate } from '@/shared/datetime/business-time';
import { useLocale } from '@/shared/locale/locale-context';
import { MonthStepper } from '@/shared/month/month-stepper';
import { nextMonth, previousMonth } from '@/shared/month/month';
import { type AttendanceSession, groupByWorkingDate } from '../model/attendance-view';
import { AttendanceSessionRow } from './attendance-session';
import { AttendanceState } from './attendance-state';

/**
 * محتوى «حضوري»: تنقّل الشهور وبعدها جلسات الشهر مجمّعة بيوم العمل (MY-14). الشاشة الفاضية بتقول
 * إن مفيش جلسات، وخطأ القراءة بيبان مع زر إعادة محاولة، ورفض الصلاحية بيبان من غير زر.
 *
 * @param props.month الشهر المعروض
 * @param props.home الشهر الحالي من السيرفر، لقفل زر «التالي»
 * @param props.sessions جلسات الشهر
 * @param props.status حالة القراءة
 * @param props.error آخر خطأ في القراءة
 * @param props.timeZone توقيت النشاط
 * @param props.canGoBack هل زر «الشهر السابق» متاح
 * @param props.canGoForward هل زر «الشهر التالي» متاح
 * @param props.onMonth تغيير الشهر
 * @param props.onRetry إعادة المحاولة
 */
export function AttendanceMonth({
  month,
  home,
  sessions,
  status,
  error,
  timeZone,
  canGoBack,
  canGoForward,
  onMonth,
  onRetry,
}: {
  month: string | undefined;
  home: string | undefined;
  sessions: readonly AttendanceSession[];
  status: 'pending' | 'ready' | 'error';
  error: unknown;
  timeZone: string | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  onMonth: (month: string | undefined) => void;
  onRetry: () => void;
}) {
  const locale = useLocale();
  const days = groupByWorkingDate(sessions);
  // الخطوة التالية بتطلب «الحالي» من السيرفر لو الشهر ده هو شهر السيرفر نفسه (الشهر بيتغير مع الوقت).
  const next = month === undefined ? undefined : nextMonth(month);
  return (
    <div className="grid gap-4">
      <MonthStepper
        month={month}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        labels={{
          previous: t(locale, 'myAttendance.previousMonth'),
          next: t(locale, 'myAttendance.nextMonth'),
        }}
        onPrevious={() => onMonth(month === undefined ? undefined : previousMonth(month))}
        onNext={() => onMonth(next === home ? undefined : next)}
      />
      <AttendanceState status={status} error={error} onRetry={onRetry} />
      {status === 'ready' && days.length === 0 ? (
        <p role="status">{t(locale, 'myAttendance.empty')}</p>
      ) : null}
      {days.map((day) => (
        <section key={day.workingDate} className="grid gap-2">
          <h3 className="tabular-nums">{formatBusinessDate(day.workingDate, locale)}</h3>
          <ul className="grid gap-2">
            {day.sessions.map((session) => (
              <AttendanceSessionRow key={session.id} session={session} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
