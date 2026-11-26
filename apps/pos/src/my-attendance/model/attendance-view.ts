import type { OwnAttendance, PersonalBranches } from '@pospay/contracts';
import type { Locale } from '@pospay/i18n';

/** جلسة حضور واحدة زي ما السيرفر رجّعها (MY-14). */
export type AttendanceSession = OwnAttendance['sessions'][number];

/** نوع الاستثناء المفتوح في الجلسة (من غير «NONE»). */
export type AttendanceExceptionKind = 'OUT_OF_RANGE' | 'SUSPECTED_MISSED_OUT';

/** فرع الموظفة وتوقيته، من مسار الفروع الشخصي. */
export type AttendanceBranch = PersonalBranches['items'][number];

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

/**
 * توقيت عرض ساعات جلسة واحدة. الجلسة بتتطابق مع فرعها بالاسم (الإنجليزي، والعربي لو الجلسة فيها اسم عربي)؛ لو
 * الفروع المتطابقة كلها بتوقيت واحد بنستخدمه، فكل جلسة بتتعرض بساعة فرعها هي حتى لو الموظفة بتشتغل في أكتر من
 * فرع بتوقيتات مختلفة. لو مفيش تطابق بالاسم بنستخدم توقيت الفروع بس لما يبقوا كلهم بنفس التوقيت، وغير كده
 * (فروع مختلفة التوقيت، أو الفروع فاضية أو فشلت) بنرجع لتوقيت الجهاز المتاح، ولو مفيش فبيرجع undefined
 * عشان الساعة تتعرض بـ UTC مكتوب جنبها بدل توقيت غلط (AC-57-4-9).
 *
 * @param session جلسة الحضور
 * @param branches فروع الموظفة من الرد الشخصي، أو undefined لو ما اتقرتش
 * @param fallbackTimeZone توقيت بديل (فرع جهاز الاستقبال) لما الفروع ما تحسمش
 * @returns اسم IANA لتوقيت الجلسة، أو undefined لو مش معروف
 */
export function resolveSessionTimeZone(
  session: Pick<AttendanceSession, 'branch_name_en' | 'branch_name_ar'>,
  branches: readonly AttendanceBranch[] | undefined,
  fallbackTimeZone?: string,
): string | undefined {
  if (branches === undefined || branches.length === 0) return fallbackTimeZone;
  const matched = branches.filter(
    (branch) =>
      branch.name_en === session.branch_name_en &&
      (session.branch_name_ar === null || branch.name_ar === session.branch_name_ar),
  );
  const candidates = matched.length > 0 ? matched : branches;
  const zones = new Set(candidates.map((branch) => branch.timezone));
  const [only] = zones;
  return zones.size === 1 ? only : fallbackTimeZone;
}
