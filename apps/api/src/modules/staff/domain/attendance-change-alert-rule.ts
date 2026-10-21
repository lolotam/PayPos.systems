import type { AlertRecipientRole, EffectiveAlertRule } from '@pospay/domain';

/** نوعا التنبيه الخاصان بطلب تعديل الحضور وبقراره. */
export type AttendanceChangeAlertKind =
  | 'ATTENDANCE_CHANGE_REQUESTED'
  | 'ATTENDANCE_CHANGE_DECIDED';

/** خطة الإشعار المسموح بها للمُرسِل بعد قراءة القاعدة الفعلية. */
export interface AttendanceChangeAlertPlan {
  /** المستلم الثابت للنوع يتحسب من السلطة؛ false = القاعدة ما جابتش المستلم الثابت بتاع النوع. */
  readonly fixed: boolean;
  /** قناة الإشعار اللي بتتكتب في الحدث؛ null = بلا إشعار. */
  readonly channel: 'IN_APP' | null;
  /** أدوار القاعدة اللي بتزود مستلمين جنب المستلم الثابت؛ فاضية = مفيش قراءة أدوار. */
  readonly roles: readonly AlertRecipientRole[];
}

/** معامل إشعار واحد: الاسم والقيمة. */
export interface AttendanceChangeNoticeParameter {
  /** اسم المعامل زي ما القالب مستنيه. */
  readonly name: string;
  /** نوع القيمة؛ نصوص بس في إشعارات الديسكتوب. */
  readonly type: 'text';
  /** قيمة المعامل. */
  readonly value: string;
}

const NOTHING: AttendanceChangeAlertPlan = { fixed: false, channel: null, roles: [] };

const DECIDE_PERMISSION = 'decide:attendance-change:company';

/**
 * بيقول إن القاعدة جابت المستلم الثابت اللي النوع محتاجه: حازمو صلاحية القرار لطلب التعديل،
 * وصاحب الطلب لقراره. دي المستلم الثابت بس؛ مستلمي الأدوار بيتحسبوا من غيرها.
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
 * بيحوّل القاعدة الفعلية لنوع التنبيه إلى اللي المُرسِل مسموح يعمله: يحسب المستلم الثابت، ويزود مستلمي
 * أدوار القاعدة، ويكتب قناة الإشعار. كل واحد فيهم بيتحسب لوحده: القاعدة اللي ما جابتش المستلم الثابت
 * ما بتقراش حازمين القرار، والقاعدة المقفولة (النوع مطفي أو المفتاح العام مقفول) ما بتقراش حاجة خالص.
 *
 * @param rule القاعدة الفعلية بعد المفتاح العام
 * @param kind نوع التنبيه: طلب التعديل أم قراره
 * @returns الخطة: هل المستلم الثابت يتحسب وإيه القناة وإيه الأدوار اللي بتتحسب
 */
export function attendanceChangeAlertPlan(
  rule: EffectiveAlertRule,
  kind: AttendanceChangeAlertKind,
): AttendanceChangeAlertPlan {
  const channel = rule.enabled && rule.channels.includes('IN_APP') ? 'IN_APP' : null;
  if (channel === null) return NOTHING;
  return { fixed: carriesSelector(rule, kind), channel, roles: rule.recipientRoles };
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

/**
 * معاملات إشعار مستلم واحد: سبب القرار بيوصل لصاحب الطلب بس، وأي مستلم تاني (من الأدوار أو من غيرها)
 * بياخد شرطة، عشان سبب القرار ما يوصلش لغير صاحبه (ADR-0040). طلب المعلّق مافيهوش معامل سبب أصلاً.
 *
 * @param safe        الأسماء الآمنة وسبب القرار الآمن
 * @param safe.employee_name_ar الاسم العربي الآمن
 * @param safe.employee_name_en الاسم الإنجليزي الآمن
 * @param safe.reason سبب القرار الآمن
 * @param request     الطلب: نوعه وحالته وصاحب الطلب
 * @param request.kind نوع الطلب
 * @param request.status حالة الطلب
 * @param request.requested_by صاحب الطلب
 * @param recipientId المستلم اللي المعاملات بتاعته
 * @returns معاملات الإشعار بالترتيب اللي القالب بيستناه
 */
export function attendanceChangeNoticeParameters(
  safe: {
    readonly employee_name_ar: string;
    readonly employee_name_en: string;
    readonly reason: string;
  },
  request: { readonly kind: string; readonly status: string; readonly requested_by: string },
  recipientId: string,
): AttendanceChangeNoticeParameter[] {
  const parameter = (name: string, value: string): AttendanceChangeNoticeParameter => ({
    name,
    type: 'text',
    value,
  });
  return [
    parameter('employee_name_ar', safe.employee_name_ar),
    parameter('employee_name_en', safe.employee_name_en),
    parameter('change', request.kind),
    ...(request.status === 'PENDING'
      ? []
      : [
          parameter('decision', request.status),
          parameter('reason', recipientId === request.requested_by ? safe.reason : '-'),
        ]),
  ];
}
