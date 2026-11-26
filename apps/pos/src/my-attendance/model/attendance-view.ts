import type { OwnAttendance } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

/** جلسة حضور واحدة زي ما السيرفر رجّعها (MY-14). */
export type AttendanceSession = OwnAttendance['sessions'][number];

/** نوع الاستثناء المفتوح في الجلسة (من غير «NONE»). */
export type AttendanceExceptionKind = 'OUT_OF_RANGE' | 'SUSPECTED_MISSED_OUT';

/** يوم عمل واحد وجلساته، بترتيب السيرفر. */
export type AttendanceDay = { workingDate: string; sessions: AttendanceSession[] };

/**
 * تجميع جلسات الشهر بيوم العمل (`working_date`)، مع الحفاظ على ترتيب السيرفر: الأيام بترتيب أول ظهور،
 * والجلسات داخل اليوم بترتيبها زي ما رجعت.
 *
 * @param sessions جلسات الشهر
 * @returns الأيام وجلساتها
 */
export function groupByWorkingDate(sessions: readonly AttendanceSession[]): AttendanceDay[] {
  const days = new Map<string, AttendanceSession[]>();
  for (const session of sessions) {
    const list = days.get(session.working_date);
    if (list === undefined) days.set(session.working_date, [session]);
    else list.push(session);
  }
  return [...days].map(([workingDate, list]) => ({ workingDate, sessions: list }));
}

/**
 * اسم الفرع بلغة العرض؛ الاسم العربي ممكن يبقى null، فبنرجع للإنجليزي (D-A10).
 *
 * @param session جلسة الحضور
 * @param locale لغة العرض
 * @returns اسم الفرع
 */
export function sessionBranchName(session: AttendanceSession, locale: Locale): string {
  return locale === 'ar' && session.branch_name_ar ? session.branch_name_ar : session.branch_name_en;
}

/**
 * أنواع الاستثناءات المفتوحة في الجلسة («NONE» مش استثناء)، بالترتيب اللي السيرفر رجع بيه (D-A10).
 *
 * @param session جلسة الحضور
 * @returns أنواع الاستثناءات المفتوحة
 */
export function openExceptionKinds(session: AttendanceSession): AttendanceExceptionKind[] {
  return session.open_exceptions.filter(
    (kind): kind is AttendanceExceptionKind => kind !== 'NONE',
  );
}
