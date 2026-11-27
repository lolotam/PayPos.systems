/**
 * جدول الدور ← نوع النطاق اللي الدور محتاجه، وهو المصدر الوحيد للحقيقة: قائمة الأدوار اللي بتتدى
 * بالدعوة (IM-Q2، ومعاها دور المالك اللي مش فيها أبداً) ونوع النطاق كلاهما مشتق منه، فتغيير اختيار
 * المالك تعديل بيانات في مكان واحد (BR-5).
 */
export const INVITABLE_SCOPE_TYPE = {
  general_manager: 'COMPANY',
  business_manager: 'BUSINESS',
  branch_manager: 'BRANCH',
  accountant: 'COMPANY',
} as const;

/** كود دور من أدوار الدعوة — مفتاح الجدول فوق. */
export type InvitableRole = keyof typeof INVITABLE_SCOPE_TYPE;

/** أنواع النطاق اللي بتتدى بيها العضوية — قيم الجدول فوق. */
export type InvitationScopeType = (typeof INVITABLE_SCOPE_TYPE)[InvitableRole];

/** الأدوار اللي بتتدى بالدعوة، بترتيب الجدول. */
export const INVITABLE_ROLES = Object.keys(INVITABLE_SCOPE_TYPE) as readonly InvitableRole[];

/**
 * بيقول إن الدور ده من أدوار الدعوة ولا لأ.
 *
 * @param role كود الدور كما جاء في الطلب
 * @returns true لما يكون الدور من أدوار الدعوة
 */
export function isInvitableRole(role: string): role is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

/**
 * نوع النطاق اللي بيطلبه الدور.
 *
 * @param role كود الدور كما جاء في الطلب
 * @returns نوع النطاق، أو null لما الدور مش قابل للدعوة
 */
export function invitableScopeType(role: string): InvitationScopeType | null {
  return isInvitableRole(role) ? INVITABLE_SCOPE_TYPE[role] : null;
}

/**
 * بيحكم على الدور والنطاق اللي في الطلب: لازم الدور يكون من قائمة الدعوة، والنطاق يطابق
 * نوع النطاق اللي الدور بيطلبه. النطاق نفسه بيتفحص تاني على إنّه تابع للشركة.
 *
 * @param role كود الدور كما جاء في الطلب
 * @param scopeType نوع النطاق كما جاء في الطلب
 * @returns null لما الطلب سليم، أو كود الرفض
 */
export function invitationScopeFailure(
  role: string,
  scopeType: string,
): 'MEMBER_ROLE_NOT_INVITABLE' | null {
  const required = invitableScopeType(role);
  if (required === null) return 'MEMBER_ROLE_NOT_INVITABLE';
  return required === scopeType ? null : 'MEMBER_ROLE_NOT_INVITABLE';
}

/** توزيع دور مع نطاقه: الدور الأساسي للدعوة أو دور إضافي من «أدوار أكتر» (080). */
export interface InvitationAssignment {
  readonly role: InvitableRole;
  readonly scope: { readonly type: InvitationScopeType; readonly id: string };
}

/** نتيجة جمع التوزيعات: إمّا كلها صالحة، أو كود الرفض بتاع أول توزيع غلط. */
export type InvitationAssignments =
  | { readonly ok: true; readonly assignments: readonly InvitationAssignment[] }
  | { readonly ok: false; readonly refusal: 'MEMBER_ROLE_NOT_INVITABLE' };

/** مدخل جمع التوزيعات: الدور الأساسي ونطاقه والأدوار الإضافية («أدوار أكتر»). */
export interface InvitationAssignmentInput {
  readonly role: InvitableRole;
  readonly scope: { readonly type: InvitationScopeType; readonly id: string };
  readonly additional_roles?: readonly InvitationAssignment[] | undefined;
}

/**
 * بيجمع الدور الأساسي والأدوار الإضافية وبيشيل المكرر، وبيحكم على كل واحد بجدول
 * الأدوار: النطاق لازم يطابق نوع النطاق اللي الدور بيطلبه. التكرار بيتشال بترتيب ثابت
 * (الأساسي الأول) عشان نفس الطلب يبقى نفس النتيجة كل مرة.
 *
 * @param input الدور الأساسي ونطاقه والأدوار الإضافية
 * @returns التوزيعات بعد إزالة المكرر، أو كود الرفض
 */
export function collectInvitationAssignments(
  input: InvitationAssignmentInput,
): InvitationAssignments {
  const assignments: InvitationAssignment[] = [];
  const seen = new Set<string>();
  for (const entry of [
    { role: input.role, scope: input.scope },
    ...(input.additional_roles ?? []),
  ]) {
    if (invitationScopeFailure(entry.role, entry.scope.type) !== null) {
      return { ok: false, refusal: 'MEMBER_ROLE_NOT_INVITABLE' };
    }
    const key = `${entry.role}:${entry.scope.type}:${entry.scope.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    assignments.push({ role: entry.role, scope: { ...entry.scope } });
  }
  return { ok: true, assignments };
}

/** مستلم بريد دعوة عضو بعد حسم الاستهداف والقناع داخل الدومين. */
export interface InvitationNoticeRecipientSpec {
  readonly email: string;
  readonly recipient: 'invitee' | 'owner';
  readonly targetMaskedEmail: string | null;
}

/**
 * يحسب لحظة انتهاء صلاحية رابط دعوة العضو في الدومين انطلاقاً من وقت الإصدار.
 *
 * @param issuedAt لحظة إصدار الرابط من الساعة المحقونة
 * @param ttlMs مدة صلاحية الرابط بالمللي ثانية
 * @returns لحظة انتهاء الرابط
 */
export function memberInvitationLinkExpiresAt(issuedAt: Date, ttlMs: number): Date {
  return new Date(issuedAt.getTime() + ttlMs);
}

/**
 * يختار مستلمي بريد الدعوة في الدومين: المدعوّ أولاً ثم المالك الداعي عند اختلاف البريد.
 *
 * @param input بريد المدعوّ وبريد المالك ودالة القناع
 * @param input.inviteeEmail بريد المدعوّ الحقيقي أو null
 * @param input.ownerEmail بريد المالك الحقيقي أو null
 * @param input.mask دالة قناع البريد لعرضه للمالك
 * @returns قائمة المستلمين بدون تكرار
 */
export function selectMemberInvitationNoticeRecipients(input: {
  readonly inviteeEmail: string | null;
  readonly ownerEmail: string | null;
  readonly mask: (email: string) => string;
}): readonly InvitationNoticeRecipientSpec[] {
  const recipients: InvitationNoticeRecipientSpec[] = [];
  if (input.inviteeEmail !== null) {
    recipients.push({ email: input.inviteeEmail, recipient: 'invitee', targetMaskedEmail: null });
  }
  if (
    input.ownerEmail !== null &&
    input.ownerEmail.trim().toLowerCase() !== input.inviteeEmail?.trim().toLowerCase()
  ) {
    recipients.push({
      email: input.ownerEmail,
      recipient: 'owner',
      targetMaskedEmail: input.inviteeEmail === null ? null : input.mask(input.inviteeEmail),
    });
  }
  return recipients;
}
