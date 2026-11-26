import { t, type MessageKey } from '@pospay/i18n';
import { formatBusinessTime } from '@/shared/datetime/business-time';
import { useLocale } from '@/shared/locale/locale-context';
import {
  type AttendanceExceptionKind,
  type AttendanceSession,
  openExceptionKinds,
  sessionBranchName,
} from '../model/attendance-view';

const SOURCE_KEYS = {
  QR: 'myAttendance.sourceQr',
  BARCODE: 'myAttendance.sourceBarcode',
  MANUAL: 'myAttendance.sourceManual',
} as const satisfies Record<AttendanceSession['source'], MessageKey>;

const EXCEPTION_KEYS = {
  OUT_OF_RANGE: 'myAttendance.exceptionOutOfRange',
  SUSPECTED_MISSED_OUT: 'myAttendance.exceptionSuspectedMissedOut',
} as const satisfies Record<AttendanceExceptionKind, MessageKey>;

/**
 * جلسة حضور واحدة: الفرع، وقت الحضور، وقت الانصراف، التأخير، مصدر البصمة، والاستثناءات المفتوحة.
 * الجلسة اللي المدير عدّلها بتعرض الوقت الجديد وعلامة «اتعدّل» بس (MY-Q7): الرد نفسه مفيهوش
 * وقت قديم ولا سبب ولا اسم مين عدّل.
 *
 * @param props.session الجلسة من رد السيرفر
 * @param props.timeZone توقيت فرع الجلسة؛ لو مش معروف بتتعرض الساعات بـ UTC مكتوب جنبها
 */
export function AttendanceSessionRow({
  session,
  timeZone,
}: {
  session: AttendanceSession;
  timeZone: string | undefined;
}) {
  const locale = useLocale();
  const exceptions = openExceptionKinds(session);
  const clockOut =
    session.status === 'OPEN'
      ? t(locale, 'myAttendance.stillClockedIn')
      : session.status === 'MISSED_OUT'
        ? t(locale, 'myAttendance.missedOut')
        : session.clock_out === null
          ? ''
          : formatBusinessTime(session.clock_out, locale, timeZone);
  return (
    <li className="grid gap-1 rounded border p-2">
      <span className="font-semibold">{sessionBranchName(session, locale)}</span>
      <span className="tabular-nums">
        {t(locale, 'myAttendance.clockIn')}: {formatBusinessTime(session.clock_in, locale, timeZone)}
      </span>
      <span className="tabular-nums">
        {t(locale, 'myAttendance.clockOut')}: {clockOut}
      </span>
      {session.late_minutes > 0 ? (
        <span>
          {t(locale, 'myAttendance.lateMinutes').replace(
            '{minutes}',
            new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).format(session.late_minutes),
          )}
        </span>
      ) : null}
      <span>{t(locale, SOURCE_KEYS[session.source])}</span>
      {exceptions.length === 0 ? null : (
        <span>
          {exceptions.map((kind) => t(locale, EXCEPTION_KEYS[kind])).join(' · ')}
        </span>
      )}
      {session.corrected ? <span>{t(locale, 'myAttendance.corrected')}</span> : null}
    </li>
  );
}
