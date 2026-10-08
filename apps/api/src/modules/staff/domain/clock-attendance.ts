/** بيانات الموقع اختيارية؛ غيابها استثناء مسجل لا منع للحضور. */
export interface ClockLocation {
  readonly lat: number;
  readonly lng: number;
  readonly accuracy: number;
}
/** الرد محفوظ كما قُبل عشان dedupe لا يبدّل نتيجة الموظف. */
export interface ClockResult {
  session_id: string;
  operation: 'CLOCK_IN' | 'CLOCK_OUT';
  working_date: string;
  accepted_at: string;
  exceptions: ('NONE' | 'OUT_OF_RANGE')[];
  late_minutes: number;
  missed_session_id: string | null;
}
/** البيانات الدنيا للقواعد؛ لا اعتماد على مصدر الوقت أو التخزين. */
export interface OpenAttendance {
  id: string;
  clockIn: Date;
  workingDate: string;
  lateMinutes: number;
  branchId: string;
}
/** الرفض لا يحمل أي تفاصيل عن موظف أو ربط غير متاح. */
export class AttendanceError extends Error {
  /** يحتفظ بالرمز فقط كي لا تتسرب بيانات سياق الشركة.
   *
   * @param code سبب الرفض الآمن
   */
  constructor(readonly code: 'NOT_FOUND' | 'PASSKEY_INVALID' | 'BAD_REQUEST' | 'FORBIDDEN') {
    super(code);
  }
}
/** يحدد الانتقال بحد ١٦ ساعة شامل؛ الحضور لا يحسب أجراً.
 *
 * @param open الجلسة المفتوحة الحالية
 * @param at وقت الطلب الواحد
 * @returns فتح أو قفل طبيعي أو قفل مفقود ثم فتح
 */
export function attendanceTransition(
  open: OpenAttendance | null,
  at: Date,
): 'IN' | 'OUT' | 'MISSED_IN' {
  if (open === null) return 'IN';
  return at.getTime() - open.clockIn.getTime() < 16 * 60 * 60 * 1000 ? 'OUT' : 'MISSED_IN';
}
/** يعيد نفس الرد خلال خمس دقائق ولا يمد فترة المنع مع المحاولات.
 *
 * @param lastAt آخر حركة مقبولة
 * @param lastResult الرد الأصلي
 * @param at وقت الطلب
 * @returns الرد الأصلي أو null عند السماح بانتقال جديد
 */
export function attendanceDuplicate(
  lastAt: Date | null,
  lastResult: ClockResult | null,
  at: Date,
): ClockResult | null {
  return lastAt !== null && at.getTime() - lastAt.getTime() < 5 * 60 * 1000 ? lastResult : null;
}
/** يوم الحضور هو تاريخ clock-in في الفرع حتى لو انتهت الوردية غداً.
 *
 * @param at وقت بداية الحركة
 * @param timezone منطقة الفرع الزمنية
 * @returns تاريخ ميلادي محلي ثابت للجلسة
 */
export function attendanceWorkingDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (name: string) => parts.find((p) => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
/** Haversine يحسب المسافة على سطح الأرض بدلاً من قياس فرق درجات الإحداثيات.
 *
 * @param a موقع الهاتف
 * @param b موقع الفرع
 * @returns المسافة بالأمتار
 */
export function attendanceDistance(a: AttendancePoint, b: AttendancePoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const angle =
    Math.sin(radians(b.lat - a.lat) / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lng - a.lng) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, angle))));
}
/** المسافة ١٥٠م حد الاستثناء فقط؛ لا نرفض الحضور بسبب GPS.
 *
 * @param location قراءة الهاتف أو غياب الإذن
 * @param branch إحداثيات الفرع المسجلة
 * @returns حقيقة التقرير الجغرافية
 */
export function attendanceGeofence(
  location: ClockLocation | undefined,
  branch: { lat: number; lng: number } | null,
): 'OK' | 'NONE' | 'OUT_OF_RANGE' {
  // قرار المالك 2026-10-04 (AT-Q1/AT-Q3، الخيار الموصى به): غياب إعداد الفرع أو إذن GPS يسجل NONE ويسمح بالحركة مبدئياً.
  if (location === undefined || branch === null) return 'NONE';
  // قرار المالك 2026-10-04 (AT-Q2، الخيار الموصى به): لا يُرفع الاستثناء إلا إذا تجاوز أقرب موضع محتمل ١٥٠م.
  // هامش عددي نانومتري يعالج خطأ floating point عند الحد نفسه، وليس تسامح GPS إضافياً.
  return attendanceDistance(location, branch) - location.accuracy > 150 + 1e-9
    ? 'OUT_OF_RANGE'
    : 'OK';
}
/** التأخير حقيقة تقرير فقط؛ مهلة عشر دقائق لا تخصم عمولة.
 *
 * @param scheduledStart بداية الوردية المثبتة أو غياب جدول
 * @param at clock-in الفعلي
 * @returns الدقائق الكاملة بعد تجاوز المهلة أو صفر
 */
export function attendanceLateMinutes(scheduledStart: Date | null, at: Date): number {
  if (scheduledStart === null) return 0;
  const elapsed = at.getTime() - scheduledStart.getTime();
  // قرار المالك 2026-10-04 (AT-Q7، الخيار الموصى به): بعد تجاوز المهلة بعرض كامل التأخير دون طرح المهلة.
  return elapsed <= 10 * 60 * 1000 ? 0 : Math.floor(elapsed / 60_000);
}
/** حد القفل المفقود ثابت حتى لو جاء اكتشافه بعد أيام؛ لا يستنتج ساعات مستحقة.
 *
 * @param open الجلسة المفقودة
 * @returns لحظة بلوغ حد ١٦ ساعة
 */
export function attendanceMissedDeadline(open: OpenAttendance): Date {
  // قرار المالك 2026-10-04 (AT-Q6، الخيار الموصى به): قفل MISSED_OUT عند حد ١٦ ساعة وتسجيل الاكتشاف منفصلاً.
  return new Date(open.clockIn.getTime() + 16 * 60 * 60 * 1000);
}
/** الحقائق الدنيا التي يحسبها الانتقال؛ المصدر يقرر الاستثناء والموقع يبقى حقيقة الجلسة. */
export interface AttendancePlanInput {
  open: OpenAttendance | null;
  timezone: string;
  shifts: readonly { startsAt: Date; endsAt: Date; workingDate: string }[];
  location: ClockLocation | undefined;
  geo: { lat: number; lng: number } | null;
  source: 'QR' | 'BARCODE';
}
/** خطة حركة واحدة: الرد المقبول ولحظة القفل والموقع والوردية. */
export interface AttendancePlan {
  result: ClockResult;
  closeAt: Date | null;
  geo: 'OK' | 'NONE' | 'OUT_OF_RANGE';
  schedule: { startsAt: Date; endsAt: Date } | null;
}
/**
 * حركة الكارت لا ترفع استثناء؛ مسح QR يرفع NONE أو OUT_OF_RANGE كما كان.
 *
 * @param source مصدر المسح
 * @param geo حقيقة الموقع التي تُخزن على الجلسة
 * @returns الاستثناءات التي تُكتب، أو مصفوفة فارغة للكارت
 */
export function attendanceRaisedExceptions(
  source: 'QR' | 'BARCODE',
  geo: 'OK' | 'NONE' | 'OUT_OF_RANGE',
): ('NONE' | 'OUT_OF_RANGE')[] {
  // قرار المالك 2026-10-08 (RE-Q4): الكارت على جهاز الفرع لا يرفع استثناء؛ QR يبقى كما هو.
  if (source === 'BARCODE') return [];
  return geo === 'OK' ? [] : [geo];
}
/** يحسب الرد من نفس قواعد spec 027 لـ QR والكارت. المصدر يقرر الاستثناءات وgeo يبقى حقيقة الموقع.
 *
 * @param input حقائق الجلسة المفتوحة والورديات والموقع ومصدر المسح
 * @param at وقت الطلب الواحد بعد كل الأقفال
 * @param newSessionId معرّف محتمل للجلسة الجديدة، يُستخدم عند الفتح فقط
 * @returns الرد المقبول وما يُكتب معه في نفس المعاملة
 */
export function planAttendance(
  input: AttendancePlanInput,
  at: Date,
  newSessionId: string,
): AttendancePlan {
  const transition = attendanceTransition(input.open, at);
  const workingDate = attendanceWorkingDate(at, input.timezone);
  const schedule = attendanceSchedule(input.shifts, at, workingDate);
  const geo = attendanceGeofence(input.location, input.geo);
  const closing = transition === 'OUT';
  return {
    result: {
      session_id: closing && input.open !== null ? input.open.id : newSessionId,
      operation: closing ? 'CLOCK_OUT' : 'CLOCK_IN',
      working_date: closing && input.open !== null ? input.open.workingDate : workingDate,
      accepted_at: at.toISOString(),
      exceptions: attendanceRaisedExceptions(input.source, geo),
      late_minutes:
        closing && input.open !== null
          ? input.open.lateMinutes
          : attendanceLateMinutes(schedule?.startsAt ?? null, at),
      missed_session_id: transition === 'MISSED_IN' && input.open !== null ? input.open.id : null,
    },
    closeAt:
      input.open === null
        ? null
        : transition === 'MISSED_IN'
          ? attendanceMissedDeadline(input.open)
          : at,
    geo,
    schedule,
  };
}
/** الشيفت الجاري أولاً وإلا أول شيفت يبدأ في نفس اليوم؛ الغموض موثق لصاحب القرار.
 *
 * @param shifts الورديات المرشحة في الفرع
 * @param at وقت الحركة
 * @param date تاريخ clock-in المحلي
 * @returns وردية المقارنة أو null
 */
export function attendanceSchedule(
  shifts: readonly { startsAt: Date; endsAt: Date; workingDate: string }[],
  at: Date,
  date: string,
) {
  // قرار المالك 2026-10-04 (AT-Q5، الخيار الموصى به): الوردية الجارية وإلا أول بداية في يوم clock-in، دون افتراض وردية من فرع آخر.
  const sorted = [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return (
    sorted.find((s) => s.startsAt <= at && s.endsAt > at) ??
    sorted.find((s) => s.workingDate === date) ??
    null
  );
}
/** أهلية تاريخية للفرع المسجل، لا يكفي primary_branch الذي قد يكون تغير.
 *
 * @param employee تاريخ عقد الموظف وارتباطاته
 * @param branchId فرع QR
 * @param date تاريخ الفرع المحلي
 * @returns أهلية يوم الحركة
 */
export function attendanceEligible(
  employee: AttendanceEmployee,
  branchId: string,
  date: string,
): boolean {
  // قرار المالك 2026-10-04 (AT-Q4، الخيار الموصى به): رفض QR من فرع غير مرتبط بالموظف في تاريخ الفرع نفسه.
  return (
    employee.hire_date <= date &&
    (employee.contract_end === null || employee.contract_end >= date) &&
    employee.attachments.some(
      (a) => a.branch_id === branchId && a.from <= date && (a.to === null || a.to > date),
    )
  );
}
/** النقطة الجغرافية لا تحمل أي مبالغ مالية. */
interface AttendancePoint {
  lat: number;
  lng: number;
}
/** تواريخ أهلية الموظف محلية؛ نهاية الارتباط exclusive ونهاية العقد inclusive. */
interface AttendanceEmployee {
  hire_date: string;
  contract_end: string | null;
  attachments: { branch_id: string; from: string; to: string | null }[];
}
