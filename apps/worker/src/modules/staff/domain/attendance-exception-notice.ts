import {
  arabicDisplayName,
  DEFAULT_NAME_FALLBACK,
  englishDisplayName,
  formatLocalShiftStart,
  type NameFallback,
} from './not-clocked-in.ts';

/**
 * جرس استثناء الحضور (spec 060 §B.4، AL-Q8b): الموظفة والفرع والتاريخ والوقت المحليين لبصمة الدخول المفتوحة.
 * الأسماء واسم الفرع تُقرأ كما هي، واسم مرفوض (رابط أو هاتف أو رمز) يرجع للإنجليزي أو لاسم عام آمن.
 */

/** معامل جرس استثناء الحضور: نفس شكل معامل التنبيه مع أسماء قالب هذا الجرس. */
export interface AttendanceExceptionParameter {
  readonly name:
    | 'employee_name_ar'
    | 'employee_name_en'
    | 'branch_name_ar'
    | 'branch_name_en'
    | 'clock_in_date'
    | 'clock_in_time';
  readonly type: 'text';
  readonly value: string;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * تاريخ اللحظة بتوقيت المنطقة المحلية بصيغة YYYY-MM-DD، بلا اعتماد على ساعة الخادم.
 *
 * @param at اللحظة المراد تاريخها
 * @param timeZone منطقة IANA
 * @returns التاريخ المحلي بصيغة YYYY-MM-DD
 */
export function formatLocalDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/**
 * معاملات جرس استثناء الحضور: الموظفة والفرع والتاريخ والوقت المحليين لبصمة الدخول المفتوحة.
 * اسم مرفوض (رابط أو هاتف أو رمز) لا يُسقط الجرس: العربي الغائب أو المرفوض يرجع للإنجليزي السليم، وإلا لاسم عام آمن.
 *
 * @param employeeNameAr اسم الموظف العربي أو null
 * @param employeeNameEn اسم الموظف الإنجليزي
 * @param branchNameAr اسم الفرع العربي أو null
 * @param branchNameEn اسم الفرع الإنجليزي
 * @param clockIn لحظة بصمة الدخول
 * @param timeZone المنطقة الزمنية التي سُجّلت فيها البصمة
 * @param fallback الأسماء العامة من كتالوج اللغتين
 * @returns المعاملات بالترتيب، أو null إذا لم يخرج تاريخ أو وقت بصيغتيهما
 */
export function attendanceExceptionParameters(
  employeeNameAr: string | null,
  employeeNameEn: string,
  branchNameAr: string | null,
  branchNameEn: string,
  clockIn: Date,
  timeZone: string,
  fallback: NameFallback = DEFAULT_NAME_FALLBACK,
): readonly AttendanceExceptionParameter[] | null {
  // منطقة زمنية مخزنة غلط ما تبطلش الوظيفة كلها؛ الجرس بيسقط والاستثناء بيفضل مكتوبًا زي ما هو.
  let date: string;
  let time: string;
  try {
    date = formatLocalDate(clockIn, timeZone);
    time = formatLocalShiftStart(clockIn, timeZone);
  } catch {
    return null;
  }
  if (!LOCAL_DATE.test(date) || !LOCAL_TIME.test(time)) return null;
  return [
    named(
      'employee_name_ar',
      arabicDisplayName(employeeNameAr, employeeNameEn, fallback.employeeAr),
    ),
    named('employee_name_en', englishDisplayName(employeeNameEn, fallback.employeeEn)),
    named('branch_name_ar', arabicDisplayName(branchNameAr, branchNameEn, fallback.branchAr)),
    named('branch_name_en', englishDisplayName(branchNameEn, fallback.branchEn)),
    named('clock_in_date', date),
    named('clock_in_time', time),
  ];
}

function named(
  name: AttendanceExceptionParameter['name'],
  value: string,
): AttendanceExceptionParameter {
  return { name, type: 'text', value };
}
