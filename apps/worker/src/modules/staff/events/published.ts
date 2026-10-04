// TODO(spec) MO-Q5: لا notification_recipients قبل وصول AlertRulesPort؛ مستهلك الإشعارات يقبل الحدث بلا إرسال (موصى به).
/** يصدر مرة واحدة لكل جلسة عندما ترفع وظيفة الخروج المفقود SUSPECTED_MISSED_OUT، في نفس معاملة الاستثناء والتدقيق. */
export interface AttendanceExceptionRaised {
  readonly exception_id: string;
  readonly kind: 'SUSPECTED_MISSED_OUT';
  readonly session_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly clock_in: string;
  readonly due_at: string;
  readonly raised_at: string;
}

/** يصدر عندما تقفل الوظيفة جلسة MISSED_OUT؛ نفس عقد حدث المسح في PR 22: occurred_at حد ١٦ ساعة وrecorded_at لحظة الاكتشاف. */
export interface AttendanceMissedOut {
  readonly session_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly occurred_at: string;
  readonly recorded_at: string;
}
