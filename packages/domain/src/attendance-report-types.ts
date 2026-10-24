import type { WeekdayDefaultShift } from './default-shifts.js';

/** مدخلات الجلسة المثبتة؛ لا تُستنتج ساعات من إغلاق العامل الآلي وفق AB-Q6. */
export interface ReportSession {
  working_date: string;
  clock_in: string;
  clock_out: string | null;
  status: 'OPEN' | 'CLOSED' | 'MISSED_OUT';
  source: 'QR' | 'BARCODE' | 'MANUAL';
  late_minutes: number;
  scheduled_end: string | null;
  clock_out_corrected: boolean;
  voided: boolean;
}
/** الوردية وبريكها الفعليان في الفرع؛ وقت نهاية الوردية يربط جلسات الرجوع بنفس الوردية. */
export interface ReportShift {
  working_date: string;
  starts_at: string;
  ends_at: string;
  break_starts_at: string | null;
  break_ends_at: string | null;
}
/** الإجازة المقبولة فقط؛ معرّف الطلب يمنع تكرارها عند جمع الفروع، والجزئية لها لحظتان مثبتتان. */
export interface ReportLeave {
  id: string;
  type: 'ANNUAL' | 'SICK' | 'UNPAID' | 'OTHER';
  kind: 'FULL_DAY' | 'PARTIAL';
  from: string;
  to: string;
  starts_at: string;
  ends_at: string;
}
/** مدخلات التعاقد من إسقاط 16d؛ نهاية الارتباط مستبعدة ونهاية العقد مشمولة. */
export interface ReportContract {
  hire_date: string;
  contract_end: string | null;
  links: readonly { from: string; to: string | null }[];
  entries: readonly WeekdayDefaultShift[];
}
/** مدخلات موظف واحد في فرع واحد، دون هاتف أو راتب أو حساب مصرفي. */
export interface ReportBranchInputs {
  timezone: string;
  sessions: readonly ReportSession[];
  shifts: readonly ReportShift[];
  contract: ReportContract | null;
  /** إجازات الموظفة المقبولة من أي فرع وفق AB-Q11؛ الخصم يلتزم بتواريخ ارتباط هذا الفرع ونافذة دوامه. */
  leave_for_branch: readonly ReportLeave[];
}
/** فترة عمل من يوم لحد يوم، الطرفين مشمولان؛ بيان الحضور بياخد أي فترة مش شهر بس. */
export interface AttendancePeriod {
  from: string;
  to: string;
}
/** زوج بداية ونهاية وردية بالوقت المحلي للفرع؛ هو معنى الشيفت في فلتر BR-11. */
export interface AttendanceShiftPair {
  start: string;
  end: string;
}
/** جلسة لسه مفتوحة: يوم العمل ودخول البصمة بس؛ ما بتتحسبش في أي إجمالي. */
export interface AttendanceOpenSession {
  working_date: string;
  clock_in: string;
}
