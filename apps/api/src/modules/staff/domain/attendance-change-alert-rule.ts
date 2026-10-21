import type { AlertRecipientRole, EffectiveAlertRule } from '@pospay/domain';

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
  /** أدوار القاعدة اللي بتزود مستلمين جنب المستلم الثابت؛ فاضية = مفيش قراءة أدوار. */
  readonly roles: readonly AlertRecipientRole[];
}

const NOTHING: AttendanceChangeAlertPlan = { resolveRecipients: false, channel: null, roles: [] };

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
 * المستلم الثابت (حازمو صلاحية القرار أو صاحب الطلب) جاي من جدول الكود، وأدوار القاعدة بتزود مستلمين فوقيه.
 * القاعدة المقفولة (النوع مطفي أو المفتاح العام مقفول) ما بتحسبش المستلمين أصلاً، فمفيش قراءة سلطة زايدة.
 *
 * @param rule القاعدة الفعلية بعد المفتاح العام
 * @param kind نوع التنبيه: طلب التعديل أم قراره
 * @returns الخطة: هل المستلمون يتحسبوا وإيه القناة اللي بتتكتب وإيه الأدوار اللي بتتحسب
 */
export function attendanceChangeAlertPlan(
  rule: EffectiveAlertRule,
  kind: AttendanceChangeAlertKind,
): AttendanceChangeAlertPlan {
  const channel = rule.enabled && rule.channels.includes('IN_APP') ? 'IN_APP' : null;
  if (channel === null) return NOTHING;
  const roles = rule.recipientRoles;
  if (!carriesSelector(rule, kind) && roles.length === 0) return NOTHING;
  return { resolveRecipients: true, channel, roles };
}

/**
 * بيشيل من حازمي الأدوار اللي مش هيستقبلوا الجرس: الفاعل بتاع الحدث ما بيستقبلش إشعاره، والموظفة نفسها
 * ما بتستقبلش إشعار عن حضورها إلا لو مالك. نفس قاعدة المستلم الثابت بالظبط (ADR-0040).
 *
 * @param holders        حازمو الأدوار في نطاق الفرع
 * @param actorId        الفاعل: صاحب الطلب في طلب التعديل، وصاحب القرار في قراره
 * @param employeeUserId حساب الموظفة أو null
 * @returns معرّفات المستلمين المسموح لهم بالجرس
 */
export function attendanceChangeRoleRecipients(
  holders: readonly { userId: string; owner: boolean }[],
  actorId: string,
  employeeUserId: string | null,
): string[] {
  return holders
    .filter(
      (holder) =>
        holder.userId !== actorId && (holder.owner || holder.userId !== employeeUserId),
    )
    .map((holder) => holder.userId);
}
