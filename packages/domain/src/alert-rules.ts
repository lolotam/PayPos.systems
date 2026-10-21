/**
 * أنواع تنبيهات الفريق اللي ليها قاعدة (spec 060 §B.4). LOW_RATING بيدخل مع مسار التقييم المتأجّل (RT-Q1).
 */
export const ALERT_KINDS = [
  'SHIFT_NOT_CLOCKED_IN',
  'SHIFT_BREAK_NOT_RETURNED',
  'SHIFT_BREAK_RETURNED_OTHER_BRANCH',
  'SHIFT_ENDS_SOON',
  'ATTENDANCE_EXCEPTION',
  'DOCUMENT_EXPIRING',
  'LATE_SERVICE_SESSION',
  'SERVICE_LINE_EDITED',
  'SERVICE_LINE_CANCELLED',
  'SERVICE_LINE_PERFORMERS_CHANGED',
  'ATTENDANCE_CHANGE_REQUESTED',
  'ATTENDANCE_CHANGE_DECIDED',
  'STATEMENT_AWAITING_REVIEW',
  'STATEMENT_AWAITING_APPROVAL',
] as const;
/** نوع تنبيه من الكتالوج. */
export type AlertKind = (typeof ALERT_KINDS)[number];

/** الأدوار اللي ينفع تختارها كمستلمين (AL-Q3)، كل دور في نطاق فرع الحدث. */
export const ALERT_RECIPIENT_ROLES = [
  'owner',
  'general_manager',
  'business_manager',
  'branch_manager',
] as const;
/** دور مستلم. */
export type AlertRecipientRole = (typeof ALERT_RECIPIENT_ROLES)[number];

/** القنوات القابلة للاختيار؛ داخل التطبيق بس لحد البند 62b (AL-Q6). */
export const ALERT_CHANNELS = ['IN_APP'] as const;
/** قناة تنبيه. */
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

/**
 * مستلم ثابت للنوع، مش بيتختار من الشاشة: أصحاب صلاحية، أو شخص من سياق الحدث، أو إشعار الموبايل للموظفة نفسها.
 */
export type FixedAlertRecipient =
  | { readonly selector: 'PERMISSION_HOLDERS'; readonly permission: string }
  | { readonly selector: 'CONTEXT'; readonly who: 'REQUESTER' | 'EMPLOYEE' }
  | { readonly selector: 'EMPLOYEE_PUSH' };

/** الحقول اللي العميل يقدر يغيّرها في قاعدة. */
export interface AlertRuleSettings {
  readonly enabled: boolean;
  readonly recipientRoles: readonly AlertRecipientRole[];
  readonly channels: readonly AlertChannel[];
  readonly delayMinutes: number | null;
  readonly leadMinutes: number | null;
}

/** وصف النوع: الافتراضي (AL-Q5) وأي حقول ليها معنى فيه. */
export interface AlertKindDefinition {
  readonly defaults: AlertRuleSettings;
  readonly fixedRecipients: readonly FixedAlertRecipient[];
  /** النوع ليه مهلة بعد الحدث (دقايق) قابلة للتعديل. */
  readonly hasDelay: boolean;
  /** النوع ليه وقت قبل الحدث (دقايق) قابل للتعديل. */
  readonly hasLead: boolean;
  /** النوع بيتبعت للموظفة نفسها بإشعار ثابت، فمفيش أدوار ولا قنوات تتختار. */
  readonly employeeOnly: boolean;
}

const MANAGERS = ALERT_RECIPIENT_ROLES;
const IN_APP: readonly AlertChannel[] = ['IN_APP'];
const managersInApp = (extra: Partial<AlertKindDefinition> = {}): AlertKindDefinition => ({
  defaults: { enabled: true, recipientRoles: MANAGERS, channels: IN_APP, delayMinutes: null, leadMinutes: null },
  fixedRecipients: [],
  hasDelay: false,
  hasLead: false,
  employeeOnly: false,
  ...extra,
});
const fixedOnly = (fixed: readonly FixedAlertRecipient[]): AlertKindDefinition =>
  managersInApp({
    defaults: { enabled: true, recipientRoles: [], channels: IN_APP, delayMinutes: null, leadMinutes: null },
    fixedRecipients: fixed,
  });

/**
 * جدول الافتراضيات الوحيد في الكود (AL-Q5، PP-18.25): القاعدة اللي بيشتغل بيها كل نوع لحد ما حد يغيّره.
 * ليه في packages/domain: الـ API والـ worker لازم يقروا نفس الافتراضي، وإلا الشاشة تعرض حاجة والـ worker يبعت غيرها.
 */
export const ALERT_KIND_DEFINITIONS: Readonly<Record<AlertKind, AlertKindDefinition>> = {
  SHIFT_NOT_CLOCKED_IN: managersInApp({
    defaults: { enabled: true, recipientRoles: MANAGERS, channels: IN_APP, delayMinutes: 20, leadMinutes: null },
    fixedRecipients: [{ selector: 'EMPLOYEE_PUSH' }],
    hasDelay: true,
  }),
  SHIFT_BREAK_NOT_RETURNED: managersInApp({
    defaults: { enabled: true, recipientRoles: MANAGERS, channels: IN_APP, delayMinutes: 10, leadMinutes: null },
    hasDelay: true,
  }),
  SHIFT_BREAK_RETURNED_OTHER_BRANCH: managersInApp(),
  SHIFT_ENDS_SOON: {
    defaults: { enabled: true, recipientRoles: [], channels: [], delayMinutes: null, leadMinutes: 30 },
    fixedRecipients: [{ selector: 'EMPLOYEE_PUSH' }],
    hasDelay: false,
    hasLead: true,
    employeeOnly: true,
  },
  ATTENDANCE_EXCEPTION: managersInApp(),
  DOCUMENT_EXPIRING: fixedOnly([{ selector: 'PERMISSION_HOLDERS', permission: 'read:files:business' }]),
  LATE_SERVICE_SESSION: managersInApp(),
  SERVICE_LINE_EDITED: managersInApp(),
  SERVICE_LINE_CANCELLED: managersInApp(),
  SERVICE_LINE_PERFORMERS_CHANGED: managersInApp(),
  ATTENDANCE_CHANGE_REQUESTED: fixedOnly([
    { selector: 'PERMISSION_HOLDERS', permission: 'decide:attendance-change:company' },
  ]),
  ATTENDANCE_CHANGE_DECIDED: fixedOnly([{ selector: 'CONTEXT', who: 'REQUESTER' }]),
  STATEMENT_AWAITING_REVIEW: fixedOnly([
    { selector: 'PERMISSION_HOLDERS', permission: 'review:commissions:business' },
  ]),
  STATEMENT_AWAITING_APPROVAL: managersInApp({
    defaults: { enabled: true, recipientRoles: ['owner'], channels: IN_APP, delayMinutes: null, leadMinutes: null },
  }),
};

/** مصدر القاعدة الفعلية: الافتراضي، قاعدة النشاط، أو قاعدة الفرع. */
export type AlertRuleSource = 'DEFAULT' | 'BUSINESS' | 'BRANCH';

/** القاعدة اللي المُرسِل بيمشي عليها بعد المفتاح العام. */
export interface EffectiveAlertRule extends AlertRuleSettings {
  readonly kind: AlertKind;
  readonly source: AlertRuleSource;
  readonly fixedRecipients: readonly FixedAlertRecipient[];
  /** المفتاح العام للنشاط مقفول، فالقاعدة مقفولة مهما كانت قيمتها المخزنة. */
  readonly masterOff: boolean;
}

/**
 * بيحسب القاعدة الفعلية لنوع واحد في نطاق حدث.
 * قاعدة الفرع بتحل محل قاعدة النشاط بكل حقولها (AL-Q2)، والغياب = الافتراضي، والمفتاح العام فوق الكل (AL-Q4).
 * لما القاعدة مقفولة بيرجّع مستلمين وقنوات فاضية، عشان مُرسِل نسي يبص على enabled مايبعتش حاجة برضه.
 *
 * @param kind           نوع التنبيه
 * @param businessRule   قاعدة النشاط المخزنة أو null
 * @param branchRule     قاعدة فرع الحدث المخزنة أو null (null دايماً لنوع من غير فرع)
 * @param alertsEnabled  المفتاح العام المخزن؛ null = شغّال
 * @returns القاعدة الفعلية ومصدرها
 */
export function effectiveAlertRule(
  kind: AlertKind,
  businessRule: AlertRuleSettings | null,
  branchRule: AlertRuleSettings | null,
  alertsEnabled: boolean | null,
): EffectiveAlertRule {
  const definition = ALERT_KIND_DEFINITIONS[kind];
  const source: AlertRuleSource =
    branchRule !== null ? 'BRANCH' : businessRule !== null ? 'BUSINESS' : 'DEFAULT';
  const stored = branchRule ?? businessRule ?? definition.defaults;
  const masterOff = alertsEnabled === false;
  const enabled = stored.enabled && !masterOff;
  return {
    kind,
    source,
    masterOff,
    enabled,
    recipientRoles: enabled ? stored.recipientRoles : [],
    channels: enabled ? stored.channels : [],
    fixedRecipients: enabled ? definition.fixedRecipients : [],
    delayMinutes: stored.delayMinutes,
    leadMinutes: stored.leadMinutes,
  };
}

/** سبب رفض قاعدة: قيمة برّه المسموح للنوع. */
export type AlertRuleViolation =
  | 'DELAY_NOT_ALLOWED'
  | 'DELAY_REQUIRED'
  | 'LEAD_NOT_ALLOWED'
  | 'LEAD_REQUIRED'
  | 'MINUTES_OUT_OF_RANGE'
  | 'ROLES_NOT_ALLOWED'
  | 'CHANNELS_NOT_ALLOWED'
  | 'DUPLICATE_VALUE';

/** أقصى مهلة أو وقت مسبق بالدقايق: يوم كامل. */
export const ALERT_MAX_MINUTES = 1440;

/**
 * بيتأكد إن القاعدة المطلوبة مسموحة للنوع ده (FR-B16): المهلة والوقت المسبق في أنواعهم بس وفي المدى،
 * والأنواع اللي مستلمها ثابت (الموظفة نفسها) مالهاش أدوار ولا قنوات تتختار.
 *
 * @param kind  نوع التنبيه
 * @param rule  القيم المطلوبة
 * @returns أول سبب رفض، أو null لو القاعدة سليمة
 */
export function alertRuleViolation(kind: AlertKind, rule: AlertRuleSettings): AlertRuleViolation | null {
  const definition = ALERT_KIND_DEFINITIONS[kind];
  if (!definition.hasDelay && rule.delayMinutes !== null) return 'DELAY_NOT_ALLOWED';
  if (definition.hasDelay && rule.delayMinutes === null) return 'DELAY_REQUIRED';
  if (!definition.hasLead && rule.leadMinutes !== null) return 'LEAD_NOT_ALLOWED';
  if (definition.hasLead && rule.leadMinutes === null) return 'LEAD_REQUIRED';
  for (const minutes of [rule.delayMinutes, rule.leadMinutes]) {
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > ALERT_MAX_MINUTES))
      return 'MINUTES_OUT_OF_RANGE';
  }
  if (definition.employeeOnly && rule.recipientRoles.length > 0) return 'ROLES_NOT_ALLOWED';
  if (definition.employeeOnly && rule.channels.length > 0) return 'CHANNELS_NOT_ALLOWED';
  if (new Set(rule.recipientRoles).size !== rule.recipientRoles.length) return 'DUPLICATE_VALUE';
  if (new Set(rule.channels).size !== rule.channels.length) return 'DUPLICATE_VALUE';
  return null;
}
