/** القيم المشتركة بين الطلب والقرار؛ النصوص الحرة تظل في سجل الطلب فقط. */
export interface AttendanceChangePlan {
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  revision: number;
}
/** السلطة المقروءة بعد الأقفال، وليست ادعاء من العميل. */
export interface AttendanceChangeContext {
  userId: string;
  owner: boolean;
  now: Date;
}
/** رفض دورة الطلب بلا كشف بيانات خارج النطاق. */
export class AttendanceChangeError extends Error {
  /**
   * يحمل رمز الرفض فقط لحماية بيانات الطلب.
   *
   * @param code سبب الرفض
   */
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'VALIDATION_FAILED'
      | 'ATTENDANCE_CHANGE_SELF_FORBIDDEN'
      | 'ATTENDANCE_CHANGE_NOT_PENDING'
      | 'ATTENDANCE_CHANGE_REVISION_CONFLICT'
      | 'ATTENDANCE_CHANGE_DUPLICATE_PENDING'
      | 'ATTENDANCE_CHANGE_KIND_UNAVAILABLE'
      | 'ATTENDANCE_SESSION_OPEN'
      | 'ATTENDANCE_SESSION_VOIDED'
      | 'ATTENDANCE_SESSION_NOT_VOIDED'
      | 'ATTENDANCE_SESSION_REVISION_CONFLICT'
      | 'ATTENDANCE_RESTORE_OVERLAP'
      | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
  }
}
/**
 * يقص السبب ويفرض حدود قرار المالك قبل حفظ النص.
 *
 * @param reason السبب الخام
 * @returns السبب المقصوص من حرف إلى خمسمائة
 */
export function attendanceChangeReason(reason: string): string {
  const value = reason.trim();
  if (value.length < 1 || value.length > 500) throw new AttendanceChangeError('VALIDATION_FAILED');
  return value;
}
/**
 * يمنع طلب غير المالك لحضوره، ويثبت طلب المالك وموافقته في خطوة واحدة.
 *
 * @param input السبب المراد تسجيله
 * @param input.reason سبب الطلب
 * @param context السلطة وهوية الموظف واللحظة بعد الأقفال
 * @returns خطة الطلب الجديد ونسخته
 */
export function planChangeRequest(
  input: { reason: string },
  context: AttendanceChangeContext & {
    canRequest: boolean;
    employeeUserId: string | null;
  },
): AttendanceChangePlan {
  if (!context.canRequest) throw new AttendanceChangeError('NOT_FOUND');
  if (!context.owner && context.employeeUserId === context.userId)
    throw new AttendanceChangeError('ATTENDANCE_CHANGE_SELF_FORBIDDEN');
  const at = context.now.toISOString();
  return {
    status: context.owner ? 'APPROVED' : 'PENDING',
    reason: attendanceChangeReason(input.reason),
    requested_by: context.userId,
    requested_at: at,
    decided_by: context.owner ? context.userId : null,
    decided_at: context.owner ? at : null,
    decision_reason: null,
    cancelled_by: null,
    cancelled_at: null,
    revision: context.owner ? 1 : 0,
  };
}
function nextRevision(request: AttendanceChangePlan, revision: number): number {
  if (request.status !== 'PENDING')
    throw new AttendanceChangeError('ATTENDANCE_CHANGE_NOT_PENDING');
  if (request.revision !== revision || revision >= 2147483647)
    throw new AttendanceChangeError('ATTENDANCE_CHANGE_REVISION_CONFLICT');
  return revision + 1;
}
/**
 * يسحب صاحب الطلب نسخته المعلقة وحده؛ فحص الهوية يسبق الحالة والنسخة.
 *
 * @param request الطلب المقفول
 * @param context الفاعل والنسخة المطلوبة والوقت
 * @returns الحالة النهائية للسحب
 */
export function planChangeCancel(
  request: AttendanceChangePlan,
  context: AttendanceChangeContext & { revision: number },
): AttendanceChangePlan {
  if (request.requested_by !== context.userId) throw new AttendanceChangeError('NOT_FOUND');
  return {
    ...request,
    revision: nextRevision(request, context.revision),
    status: 'CANCELLED',
    cancelled_by: context.userId,
    cancelled_at: context.now.toISOString(),
  };
}
/**
 * يقرر حامل الصلاحية نسخة معلقة؛ غير المالك لا يقرر طلبه ولا حضوره، والرفض يحتاج سبباً.
 *
 * @param request الطلب المقفول
 * @param decision القرار والنسخة والسبب الاختياري
 * @param decision.decision الموافقة أو الرفض
 * @param decision.revision نسخة العميل
 * @param decision.reason سبب القرار الاختياري
 * @param context الصلاحية وهوية المالك والموظف واللحظة المعتمدة بعد الأقفال
 * @returns خطة القرار دون تطبيق نوع التغيير
 */
export function planChangeDecision(
  request: AttendanceChangePlan,
  decision: {
    decision: 'APPROVED' | 'REJECTED';
    revision: number;
    reason?: string | undefined;
  },
  context: AttendanceChangeContext & { canDecide: boolean; employeeUserId: string | null },
): AttendanceChangePlan {
  if (!context.canDecide) throw new AttendanceChangeError('NOT_FOUND');
  if (
    !context.owner &&
    (request.requested_by === context.userId || context.employeeUserId === context.userId)
  )
    throw new AttendanceChangeError('ATTENDANCE_CHANGE_SELF_FORBIDDEN');
  const revision = nextRevision(request, decision.revision);
  const reason = decision.reason === undefined ? null : attendanceChangeReason(decision.reason);
  if (decision.decision === 'REJECTED' && reason === null)
    throw new AttendanceChangeError('VALIDATION_FAILED');
  return {
    ...request,
    status: decision.decision,
    revision,
    decided_by: context.userId,
    decided_at: context.now.toISOString(),
    decision_reason: reason,
  };
}
/**
 * يقسم المستلمين بعد إزالة التكرار لضمان حد العقد مائة مستلم لكل حدث.
 *
 * @param users معرّفات المستلمين
 * @returns مجموعات مستقرة بلا تكرار
 */
export function attendanceChangeRecipientGroups(users: readonly string[]): string[][] {
  const unique = [...new Set(users)].sort();
  const groups: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += 100)
    groups.push(unique.slice(offset, offset + 100));
  return groups;
}

/**
 * يستبعد طالب التعديل والموظف من إشعار الانتظار؛ المالك يقدر يقرر حضوره لذلك يظل مستلماً.
 *
 * @param approvers الحائزون الفعليون للصلاحية مع هوية المالك
 * @param requesterId صاحب الطلب المستبعد دائماً
 * @param employeeUserId حساب الموظف أو null
 * @returns معرّفات المستلمين المسموح لهم بالقرار
 */
export function attendanceChangeRecipients(
  approvers: readonly { userId: string; owner: boolean }[],
  requesterId: string,
  employeeUserId: string | null,
): string[] {
  return approvers
    .filter((a) => a.userId !== requesterId && (a.owner || a.userId !== employeeUserId))
    .map((a) => a.userId);
}

const unsafeDisplayName =
  /(?:https?:|[a-z][a-z\d+.-]*:\/\/|\b[a-z\d-]+\.[a-z]{2,}\b|\p{Nd}(?:[\s().+-]*\p{Nd}){6,}|\b(?:bearer|token|otp|code)\b|^\p{Nd}{4,8}$)/iu;
const unsafeText = /(?:https?:|\+[1-9]\d{7,14}|\b(?:bearer|token|otp|code)\b|\b\d{4,8}\b)/i;
function displayName(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 && trimmed.length <= 255 && !unsafeDisplayName.test(trimmed)
    ? trimmed
    : null;
}
/**
 * يحمي نص الجرس من الروابط والأرقام الحساسة دون إسقاط إشعار القرار.
 *
 * @param names أسماء الموظف الأصلية
 * @param names.name_ar الاسم العربي إن وجد
 * @param names.name_en الاسم الإنجليزي
 * @param fallback الاسمان العامان من كتالوج اللغتين
 * @param fallback.ar الاسم العام العربي
 * @param fallback.en الاسم العام الإنجليزي
 * @param reason سبب القرار إن وجد
 * @returns أسماء عرض آمنة وسبب آمن أو شرطة
 */
export function attendanceChangeNoticeText(
  names: { name_ar: string | null; name_en: string },
  fallback: { ar: string; en: string },
  reason: string | null,
) {
  return {
    employee_name_ar: displayName(names.name_ar) ?? displayName(names.name_en) ?? fallback.ar,
    employee_name_en: displayName(names.name_en) ?? fallback.en,
    reason: reason && reason.length <= 255 && !unsafeText.test(reason) ? reason : '-',
  };
}
