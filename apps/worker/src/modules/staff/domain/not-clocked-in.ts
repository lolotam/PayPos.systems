const MINUTE_MS = 60 * 1000;

/** مهلة التنبيه الافتراضية: عشرون دقيقة منقضية من بداية الوردية (D-47). */
export const NOT_CLOCKED_IN_DELAY_MS = 20 * MINUTE_MS;

/** بداية نافذة الحضور: ساعتان منقضيتان قبل بداية الوردية. */
export const NOT_CLOCKED_IN_WINDOW_BEFORE_MS = 2 * 60 * MINUTE_MS;

/** قرار الوظيفة لوردية واحدة في لحظة واحدة؛ ALERT وحده يكتب إشعاراً. */
export type NotClockedInDecision =
  | 'ALERT'
  | 'WAIT'
  | 'EXCUSED'
  | 'CLOCKED_IN'
  | 'STALE'
  | 'INELIGIBLE';

/** القاعدة الثابتة التي يستبدلها PR 62 بقراءة AlertRulesPort؛ مكانها واحد. */
export interface InterimNotClockedInRule {
  readonly enabled: boolean;
  readonly delayMs: number;
  readonly windowBeforeMs: number;
  readonly channel: 'IN_APP';
  readonly roles: readonly ['owner', 'general_manager', 'business_manager', 'branch_manager'];
}

/** إجازة قد تغطي بداية الوردية؛ الحالة غير المعتمدة لا تُعذر حتى لو تداخلت. */
export interface LeaveInterval {
  readonly status: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** بداية الوردية ونهايتها كما خُزّنتا لحظتين UTC. */
export interface ShiftSpan {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** أثر الإجازات المعتمدة: إما إعفاء كامل أو لحظة تنبيه بعد آخر إجازة متصلة. */
export interface AppliedLeave {
  readonly excused: boolean;
  readonly alertAt: Date;
}

/** الحقائق التي يقرر بها domain بعد إعادة القراءة تحت القفل. */
export interface NotClockedInFacts {
  readonly now: Date;
  readonly shiftEndsAt: Date;
  readonly alertAt: Date;
  readonly windowStart: Date;
  readonly excused: boolean;
  readonly deleted: boolean;
  readonly contractEnd: string | null;
  readonly workingDate: string;
  readonly clockIns: readonly Date[];
}

/** حصيلة الدورة؛ null يعني فشل معاملة وتُعاد المحاولة، وfalse لا يغيّر شيئاً. */
export interface NotClockedInProgress {
  readonly notified: number;
  readonly failed: number;
}

/** معامل قالب الإشعار؛ اسم العرض يرفض الرابط والهاتف ويبقي سنة داخل الاسم. */
export interface NoticeParameter {
  readonly name:
    | 'employee_name_ar'
    | 'employee_name_en'
    | 'branch_name_ar'
    | 'branch_name_en'
    | 'shift_start';
  readonly type: 'text';
  readonly value: string;
}

/** سقف notificationRequest؛ مجموعة أكبر يرفضها المستهلك والدفتر يبقى ملتزماً فلا يصل أحد. */
export const IN_APP_RECIPIENT_GROUP_SIZE = 100;

const DISPLAY_NAME_UNSAFE =
  /(?:https?:|\+[1-9]\d{7,14}|\b(?:bearer|token|otp|code)\b|^\d{4,8}$)/i;
const SHIFT_START = /^([01]\d|2[0-3]):[0-5]\d$/;
const SAFE_EMPLOYEE = 'Employee';
const SAFE_BRANCH = 'Branch';

/** الأسماء العامة عند رفض اسم العرض. المستدعي يملؤها من الكتالوج؛ الافتراضي إنجليزي حتى لا يسقط التنبيه. */
export interface NameFallback {
  readonly employeeAr: string;
  readonly employeeEn: string;
  readonly branchAr: string;
  readonly branchEn: string;
}

const SAFE_NAME_FALLBACK: NameFallback = {
  employeeAr: SAFE_EMPLOYEE,
  employeeEn: SAFE_EMPLOYEE,
  branchAr: SAFE_BRANCH,
  branchEn: SAFE_BRANCH,
};

/**
 * القاعدة المؤقتة لتنبيه عدم الحضور حتى تصل شاشة قواعد التنبيه.
 * مفعّلة دائماً، بتأخير عشرين دقيقة، والمستلمون مديرو الفرع، والقناة داخل التطبيق فقط.
 *
 * @returns القاعدة التي يقرأها مسار الكشف حيث سيقرأ PR 62 المنفذ AlertRulesPort
 */
export function interimNotClockedInRule(): InterimNotClockedInRule {
  return {
    enabled: true,
    delayMs: NOT_CLOCKED_IN_DELAY_MS,
    windowBeforeMs: NOT_CLOCKED_IN_WINDOW_BEFORE_MS,
    channel: 'IN_APP',
    roles: ['owner', 'general_manager', 'business_manager', 'branch_manager'],
  };
}

/**
 * لحظة التنبيه: بداية الوردية زائد مهلة منقضية، لا ساعة حائط.
 * البداية مخزّنة لحظة UTC بتوقيت الفرع، فالليلي وDST لا يُعاد تفسيرهما هنا.
 *
 * @param startsAt بداية الوردية
 * @param delayMs المهلة بالمللي ثانية
 * @returns لحظة استحقاق التنبيه
 */
export function alertMoment(startsAt: Date, delayMs: number): Date {
  return new Date(startsAt.getTime() + delayMs);
}

/**
 * نافذة الحضور التي تمنع التنبيه، شاملة الطرفين.
 *
 * @param startsAt بداية الوردية
 * @param alertAt لحظة التنبيه بعد الإجازة إن وُجدت
 * @param windowBeforeMs كم قبل البداية تُحتسب الحضور
 * @returns أول وآخر لحظة حضور مقبولة
 */
export function countingWindow(
  startsAt: Date,
  alertAt: Date,
  windowBeforeMs: number,
): { readonly start: Date; readonly end: Date } {
  return { start: new Date(startsAt.getTime() - windowBeforeMs), end: alertAt };
}

/**
 * أحدث بداية وردية يمكن أن تكون مستحقة الآن، ليقرأ التخزين صفحة أصغر.
 *
 * @param now لحظة الدورة
 * @param delayMs مهلة التنبيه
 * @returns الورديات التي بدأت عند هذه اللحظة أو قبلها هي المرشحة
 */
export function dueShiftCutoff(now: Date, delayMs: number): Date {
  return new Date(now.getTime() - delayMs);
}

/**
 * يطبّق الإجازات المعتمدة المتصلة على بداية الوردية.
 * الفترة نصف مفتوحة. إجازة تتجاوز نهاية الوردية تُعفي، والتي تنتهي عند النهاية تماماً
 * تؤخر التنبيه إلى نهايتها زائد المهلة فيصبح القرار STALE. المعلّقة والمرفوضة والملغاة تُهمل.
 *
 * @param shift بداية الوردية ونهايتها
 * @param leaves إجازات الموظف المرشحة
 * @param delayMs مهلة التنبيه
 * @returns الإعفاء أو لحظة التنبيه بعد آخر إجازة تغطي المؤشر
 */
export function applyApprovedLeave(
  shift: ShiftSpan,
  leaves: readonly LeaveInterval[],
  delayMs: number,
): AppliedLeave {
  const approved = leaves
    .filter((leave) => leave.status === 'APPROVED')
    .slice()
    .sort(byLeaveStart);
  let cursor = shift.startsAt.getTime();
  let alertAt = cursor + delayMs;
  const used = new Set<number>();
  for (;;) {
    const index = coveringLeave(approved, used, cursor);
    const leave = index < 0 ? undefined : approved[index];
    if (leave === undefined) return { excused: false, alertAt: new Date(alertAt) };
    used.add(index);
    if (leave.endsAt.getTime() > shift.endsAt.getTime())
      return { excused: true, alertAt: new Date(alertAt) };
    cursor = leave.endsAt.getTime();
    alertAt = cursor + delayMs;
  }
}

/**
 * يقرر مصير الوردية بالترتيب الملزم: منتهية، ثم غير مؤهل، ثم إجازة، ثم حضور، ثم انتظار، وإلا تنبيه.
 * العقد المنتهي في يوم الوردية نفسه ما زال مؤهلاً؛ الحذف أو نهاية العقد قبل يوم العمل يُسقط الوردية.
 *
 * @param facts اللحظة والوردية والإجازة والحضور بعد القفل
 * @returns القرار
 */
export function notClockedInDecision(facts: NotClockedInFacts): NotClockedInDecision {
  if (
    facts.now.getTime() >= facts.shiftEndsAt.getTime() ||
    facts.alertAt.getTime() >= facts.shiftEndsAt.getTime()
  )
    return 'STALE';
  if (facts.deleted || (facts.contractEnd !== null && facts.contractEnd < facts.workingDate))
    return 'INELIGIBLE';
  if (facts.excused) return 'EXCUSED';
  if (clockedIn(facts)) return 'CLOCKED_IN';
  if (facts.now.getTime() < facts.alertAt.getTime()) return 'WAIT';
  return 'ALERT';
}

/**
 * ساعة بداية الوردية بتوقيت الفرع بصيغة HH:MM، من اللحظة المخزّنة لا من إعادة حساب الجدار.
 *
 * @param startsAt بداية الوردية UTC
 * @param timeZone منطقة الفرع الفعّالة
 * @returns الساعة المحلية من 00:00 إلى 23:59
 */
export function formatLocalShiftStart(startsAt: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(startsAt);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const hour = read('hour') === '24' ? '00' : read('hour');
  return `${hour}:${read('minute')}`;
}

/**
 * يقسم المستلمين مجموعات لا تتجاوز حد عقد الإشعار، بعد ترتيب ثابت وإسقاط التكرار.
 * الترتيب معجمي على معرف المستخدم حتى تعاد نفس المجموعات في كل تشغيل.
 *
 * @param userIds معرفات المستخدمين بأي ترتيب
 * @param groupSize الحد الأقصى للمجموعة، والافتراضي سقف العقد
 * @returns مجموعات مرتبة بلا تكرار؛ فارغة إن لم يوجد مستلم
 */
export function inAppRecipientGroups(
  userIds: readonly string[],
  groupSize: number = IN_APP_RECIPIENT_GROUP_SIZE,
): readonly (readonly string[])[] {
  if (!Number.isInteger(groupSize) || groupSize < 1) throw new Error('IN_APP_RECIPIENT_GROUP_INVALID');
  const unique = [...new Set(userIds)].sort();
  const groups: string[][] = [];
  for (let index = 0; index < unique.length; index += groupSize)
    groups.push(unique.slice(index, index + groupSize));
  return groups;
}

/**
 * يحذف مستخدم الموظف الغائب ويُسقط التكرار من قائمة المديرين.
 *
 * @param userIds مستخدمو العضويات المطابقة
 * @param employeeUserId مستخدم الموظف الغائب أو null
 * @returns المستلمون بلا الموظف نفسه
 */
export function withoutAbsentEmployee(
  userIds: readonly string[],
  employeeUserId: string | null,
): readonly string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const userId of userIds) {
    if (userId === employeeUserId || seen.has(userId)) continue;
    seen.add(userId);
    recipients.push(userId);
  }
  return recipients;
}

/**
 * معاملات القالب باللغتين. اسم مرفوض (رابط أو هاتف أو رمز) لا يُسقط المستلمين:
 * العربي الغائب أو المرفوض يرجع للإنجليزي السليم، وإلا لاسم عام آمن.
 *
 * @param employeeNameAr اسم الموظف العربي أو null
 * @param employeeNameEn اسم الموظف الإنجليزي
 * @param branchNameAr اسم الفرع العربي أو null
 * @param branchNameEn اسم الفرع الإنجليزي
 * @param shiftStart بداية الوردية المحلية HH:MM
 * @param fallback الأسماء العامة من كتالوج اللغتين؛ الغائب يبقى إنجليزياً آمناً
 * @returns المعاملات بالترتيب، أو null إذا لم تكن ساعة البداية HH:MM
 */
export function shiftNotClockedInParameters(
  employeeNameAr: string | null,
  employeeNameEn: string,
  branchNameAr: string | null,
  branchNameEn: string,
  shiftStart: string,
  fallback: NameFallback = SAFE_NAME_FALLBACK,
): readonly NoticeParameter[] | null {
  if (!SHIFT_START.test(shiftStart)) return null;
  return [
    named('employee_name_ar', arabicSlot(employeeNameAr, employeeNameEn, fallback.employeeAr)),
    named('employee_name_en', englishSlot(employeeNameEn, fallback.employeeEn)),
    named('branch_name_ar', arabicSlot(branchNameAr, branchNameEn, fallback.branchAr)),
    named('branch_name_en', englishSlot(branchNameEn, fallback.branchEn)),
    named('shift_start', shiftStart),
  ];
}

/**
 * يضم نتيجة معاملة وردية لحصيلة الدورة.
 *
 * @param progress الحصيلة السابقة
 * @param outcome true تنبيه جديد، false لا شيء، null إعادة محاولة
 * @returns الحصيلة بعد هذه الوردية
 */
export function recordNotClockedInOutcome(
  progress: NotClockedInProgress,
  outcome: boolean | null,
): NotClockedInProgress {
  return {
    notified: progress.notified + (outcome === true ? 1 : 0),
    failed: progress.failed + (outcome === null ? 1 : 0),
  };
}

function named(name: NoticeParameter['name'], value: string): NoticeParameter {
  return { name, type: 'text', value };
}

function arabicSlot(nameAr: string | null, nameEn: string, generic: string): string {
  return acceptedDisplayName(nameAr) ?? acceptedDisplayName(nameEn) ?? generic;
}

function englishSlot(nameEn: string, generic: string): string {
  return acceptedDisplayName(nameEn) ?? generic;
}

function acceptedDisplayName(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > 255 || DISPLAY_NAME_UNSAFE.test(trimmed)) return null;
  return trimmed;
}

function byLeaveStart(left: LeaveInterval, right: LeaveInterval): number {
  return left.startsAt.getTime() - right.startsAt.getTime() || left.endsAt.getTime() - right.endsAt.getTime();
}

function coveringLeave(leaves: readonly LeaveInterval[], used: ReadonlySet<number>, cursor: number): number {
  return leaves.findIndex(
    (leave, index) =>
      !used.has(index) && leave.startsAt.getTime() <= cursor && cursor < leave.endsAt.getTime(),
  );
}

function clockedIn(facts: NotClockedInFacts): boolean {
  const start = facts.windowStart.getTime();
  const end = facts.alertAt.getTime();
  return facts.clockIns.some((clockIn) => clockIn.getTime() >= start && clockIn.getTime() <= end);
}
