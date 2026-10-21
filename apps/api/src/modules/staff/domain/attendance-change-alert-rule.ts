import type { EffectiveAlertRule } from '@pospay/domain';

/** نوعا التنبيه الخاصان بطلب تعديل الحضور وبقراره. */
export type AttendanceChangeAlertKind =
  | 'ATTENDANCE_CHANGE_REQUESTED'
  | 'ATTENDANCE_CHANGE_DECIDED';

/** خطة الإشعار المسموح بها للمُرسِل بعد قراءة القاعدة الفعلية. */
export interface AttendanceChangeAlertPlan {
  /** المستلمون يتحسبوا من السلطة؛ false = القاعدة مقفولة أو مفيش قناة تكتبهم. */
  readonly resolveRecipients: boolean;
  /** قناة الإشعار اللي بتتكتب في الحدث؛ null = بلا إشعار. */
  readonly channel: 'IN_APP' | null;
}

const NOTHING: AttendanceChangeAlertPlan = { resolveRecipients: false, channel: null };

const DECIDE_PERMISSION = 'decide:attendance-change:company';

/**
 * بيقول إن القاعدة جابت المستلم الثابت اللي النوع محتاجه: حازمو صلاحية القرار لطلب التعديل،
 * وصاحب الطلب لقراره. القاعدة اللي من غير المستلم الثابت ده ما بتبعتش حد.
 *
 * @param rule القاعدة الفعلية بعد المفتاح العام
 * @param kind نوع التنبيه: طلب التعديل أم قراره
 * @returns true لما القاعدة فيها المستلم الثابت الخاص بالنوع
 */
function carriesSelector(rule: EffectiveAlertRule, kind: AttendanceChangeAlertKind): boolean {
  return rule.fixedRecipients.some((recipient) =>
    kind === 'ATTENDANCE_CHANGE_REQUESTED'
      ? recipient.selector === 'PERMISSION_HOLDERS' && recipient.permission === DECIDE_PERMISSION
      : recipient.selector === 'CONTEXT' && recipient.who === 'REQUESTER',
  );
}

/**
 * بيحوّل القاعدة الفعلية لنوع التنبيه إلى اللي المُرسِل مسموح يعمله: يحسب المستلمين ويكتب قناة الإشعار.
 * النوعين دول مستلمهم ثابت من جدول الكود، فالقاعدة بتتحكم في مين يستقبل الإشعار وإيه قناة الإرسال.
 * القاعدة المقفولة (النوع مطفي أو المفتاح العام مقفول) ما بتحسبش المستلمين أصلاً، فمفيش قراءة سلطة زايدة.
 *
 * @param rule القاعدة الفعلية بعد المفتاح العام
 * @param kind نوع التنبيه: طلب التعديل أم قراره
 * @returns الخطة: هل المستلمون يتحسبوا وإيه القناة اللي بتتكتب في الحدث
 */
export function attendanceChangeAlertPlan(
  rule: EffectiveAlertRule,
  kind: AttendanceChangeAlertKind,
): AttendanceChangeAlertPlan {
  const channel = rule.enabled && rule.channels.includes('IN_APP') ? 'IN_APP' : null;
  // TODO(spec): do recipientRoles added to a fixed-recipient kind (ATTENDANCE_CHANGE_*) add recipients, and through which reader?
  if (channel === null || !carriesSelector(rule, kind)) return NOTHING;
  return { resolveRecipients: true, channel };
}
