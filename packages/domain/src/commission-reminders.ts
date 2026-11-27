/**
 * كود حادثة ضياع جدولة تذكيرات كشف العمولة (ADR-0054 §2، ADR-0061 §1).
 * الكود ده هو الوحيد اللي استعادة التذكير بتتعامل معاه.
 */
export const COMMISSION_REMINDER_SCHEDULES_LOST_CODE = 'COMMISSION_REMINDER_SCHEDULES_LOST';

/**
 * هوية مستهلك جدولة تذكيرات كشف العمولة (ADR-0061 §2، FR-053).
 * تسجّل الـupsert في Redis خارج معاملة قاعدة البيانات وقبل علامة الاستهلاك، فأي فشل في
 * Redis يعني إعادة محاولة بلا علامة، والتسجيل نفسه مُعيد لتغييره فالتكرار مشكل.
 */
export const COMMISSION_REMINDER_SCHEDULE_CONSUMER_ID = 'commissions.reminder-schedule';

/**
 * رموز تنبيهات استعادة جدولة التذكيرات (ADR-0061 §4): التنبيه بيتبعت بالـlogger
 * بأكواد ثابتة، ومفيش بيانات شركة ولا أسرار في نصه.
 */
export const COMMISSION_REMINDER_ALERT_SCHEDULES_LOST = 'COMMISSION_REMINDER_SCHEDULES_LOST';
export const COMMISSION_REMINDER_ALERT_COMPANY_PARKED =
  'COMMISSION_REMINDER_COMPANY_SCHEDULING_PARKED';
export const COMMISSION_REMINDER_ALERT_RECERTIFICATION_FAILED =
  'COMMISSION_REMINDER_RECERTIFICATION_FAILED';

/**
 * كود تنبيه الفحص الدوري لتغطية الجدولات (ADR-0061 §8، issue #1220): لقى جدولة شركة ناقصة
 * والشهادة سليمة، فحاول إعادة تسجيلها. الحمولة عدّادات بس، ومفيش معرّف شركة.
 */
export const COMMISSION_REMINDER_ALERT_SCHEDULER_RESTORED =
  'COMMISSION_REMINDER_SCHEDULER_RESTORED';
