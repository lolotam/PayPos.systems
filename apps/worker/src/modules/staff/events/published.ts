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

/** يصدر مع دفتر التنبيه والتدقيق لكل مجموعة من مئة مستلم كحد أقصى؛ مفتاح الموظف وبداية الوردية يمنع إعادة إصدار كل المجموعات. */
export interface ShiftNotClockedIn {
  readonly notice_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly shift_starts_at: string;
  readonly shift_ends_at: string;
  readonly alert_due_at: string;
  readonly detected_at: string;
  /** مستخدم الموظفة للإشعار الثابت: غير null على أول حدث من التنبيه بس (أحداث المجموعات التانية null)، لما الإشعار الثابت للنوع مفعّل والموظفة ليها حساب مرتبط، وبند 28b-5 يبعت الـ PUSH من ذلك الحدث. */
  readonly employee_push_user_id: string | null;
}

/** مسار البريك القديم: يصدر بعد الكشف مع الدفتر والتدقيق؛ notice_kind يميز الغياب من إشعار الرجوع لفرع آخر (BW-Q10). */
export interface ShiftBreakNotReturned {
  readonly notice_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly shift_starts_at: string;
  readonly shift_ends_at: string;
  readonly break_ends_at: string;
  readonly break_out_at: string;
  readonly alert_due_at: string;
  readonly detected_at: string;
  readonly notice_kind?: 'break_not_returned' | 'break_returned_other_branch';
  readonly returned_branch_id?: string;
  readonly returned_at?: string;
}

// TODO(spec) MO-Q1: لا notification_recipients قبل وصول AlertRulesPort (PR 62)؛ مستهلك الإشعارات يقبل الحدث بلا إرسال (موصى به).
/** يصدر مرة واحدة لكل وثيقة لكل تاريخ انتهاء عند دخولها نافذة التنبيه، داخل نفس معاملة دفتر المنع والتدقيق. */
export interface DocumentExpiring {
  readonly document_id: string;
  readonly employee_id: string;
  readonly business_id: string;
  readonly type_code: string;
  readonly expires_on: string;
  readonly days_remaining: number;
  readonly alert_days: number;
  /** يوم النشاط المحلي الذي دخلت فيه النافذة. */
  readonly today: string;
  readonly detected_at: string;
}
