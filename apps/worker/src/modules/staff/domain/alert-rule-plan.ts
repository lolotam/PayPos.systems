import {
  ALERT_KIND_DEFINITIONS,
  type AlertRecipientRole,
  type EffectiveAlertRule,
} from '@pospay/domain';

/** أصغر مهلة بتقبلها قاعدة التنبيه: دقيقة واحدة (مدى المحقق في packages/domain). */
export const MIN_ALERT_DELAY_MS = 60 * 1000;

/** خطة التنبيه الدورية بعد قراءة القاعدة: التشغيل والتأخير والأدوار والإشعار الثابت للموظفة. */
export interface PeriodicAlertPlan {
  readonly enabled: boolean;
  readonly delayMs: number;
  readonly roles: readonly AlertRecipientRole[];
  readonly employeePush: boolean;
}

/** مدخلات الخطة: القاعدة الفعلية كما بتخرج من القارئ، لا أكثر. */
export type PeriodicAlertRule = Pick<
  EffectiveAlertRule,
  'kind' | 'enabled' | 'recipientRoles' | 'channels' | 'fixedRecipients' | 'delayMinutes'
>;

/**
 * بيحوّل القاعدة الفعلية لنوع تنبيه إلى خطة الكاشف: التأخير بالمللي ثانية، أدوار المستلمين، وإشعار الموظفة الثابت.
 * القاعدة المقفولة (أو المفتاح العام مقفول) بتدي أدوار فاضية ولا إشعار ثابت، بس بتقفل التأخير المحفوظ
 * عشان مسار الكبح يعرف إمتى كان التنبيه مستحقاً وهو مقفول.
 *
 * @param rule القاعدة الفعلية بعد المفتاح العام
 * @returns خطة التنبيه: التشغيل والتأخير والأدوار وإشعار الموظفة
 */
export function periodicAlertPlan(rule: PeriodicAlertRule): PeriodicAlertPlan {
  const minutes =
    rule.delayMinutes ?? ALERT_KIND_DEFINITIONS[rule.kind].defaults.delayMinutes ?? 10;
  return {
    enabled: rule.enabled,
    delayMs: minutes * 60_000,
    roles: rule.enabled && rule.channels.includes('IN_APP') ? rule.recipientRoles : [],
    employeePush:
      rule.enabled && rule.fixedRecipients.some((recipient) => recipient.selector === 'EMPLOYEE_PUSH'),
  };
}

/**
 * مستلم الإشعار الثابت للموظفة نفسها: معرف مستخدمها أو null.
 * العقد: بند 28b-5 هو اللي يبعت الإشعار للموظفة؛ 62-2 بيحمل القيمة بس.
 *
 * @param plan خطة التنبيه
 * @param employeeUserId مستخدم الموظفة أو null
 * @returns معرف المستخدم لو الإشعار الثابت مفعّل والمستخدم موجود، وإلا null
 */
export function employeePushRecipient(
  plan: PeriodicAlertPlan,
  employeeUserId: string | null,
): string | null {
  if (!plan.employeePush || employeeUserId === null) return null;
  return employeeUserId;
}
