import type { AuditRecord } from '../../../shared/ports/audit-trail.port.ts';
import type { DomainEvent } from '../../../shared/ports/outbox-writer.port.ts';
import type { InvitableRole, InvitationScopeType } from '../domain/invitable-roles.ts';

/** رفض متوقع في مسار الدعوة — الـ use case بيحوّله لكود خطأ معروف. */
export type MemberInvitationRefusal =
  | 'FORBIDDEN'
  | 'MEMBER_INVITATION_EXISTS'
  | 'MEMBER_ROLE_NOT_INVITABLE';

/** رفض إصدار رابط الدعوة (إعادة الإصدار): مين يتأكد من السلطة وحالة الدعوة جوه المعاملة. */
export type ReissueRefusal = 'FORBIDDEN' | 'MEMBER_INVITATION_NOT_REISSUEABLE';

/** رفض إصدار رابط الدعوة — رسالته عامة وما بتكشفش سبب الرفض ولا وجود أي حساب. */
export class MemberLinkRefusedError extends Error {
  override readonly name = 'MemberLinkRefusedError';
}

/** النطاق المطلوب للدعوة: نوع النطاق ومعرفه. */
export interface InvitationScope {
  readonly type: InvitationScopeType;
  readonly id: string;
}

/** صف الدعوة كما بيتقرأ من جدول الدعوات. */
export interface MemberInvitationRow {
  readonly id: string;
  readonly userId: string | null;
  readonly membershipId: string | null;
  readonly roleCode: string;
  readonly scopeType: InvitationScopeType;
  readonly scopeId: string;
  readonly invitedBy: string;
  readonly state: 'PENDING' | 'ACTIVE' | 'CANCELLED';
  readonly linkIssuedAt: Date | null;
  readonly createdAt: Date;
}

/** مدخلات الخطوة الأولى: السلطة والنطاق وصف الدعوة. */
export interface OpenInvitationInput {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly invitationId: string;
  readonly emailHash: string;
  readonly roleCode: InvitableRole;
  readonly scope: InvitationScope;
  readonly now: Date;
}

/** نتيجة الخطوة الأولى: صف الدعوة الجديد، أو صف PENDING قديم اتجدد لطلب مكرر بعد انقطاع (D6). */
export type OpenInvitationOutcome =
  | { readonly invitationId: string }
  | { readonly refusal: MemberInvitationRefusal };

/** مدخلات الخطوة الثالثة: العضوية والتدقيق والحدث، مبنية من الصف المقفول مش من الطلب. */
export interface CompleteInvitationInput {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly invitationId: string;
  readonly membershipId: string;
  /** اليوزر اللي الخطوة التانية عملته لهذه العملية — بيشفي صف انقطع بعد الفتح قبل العضوية. */
  readonly userId: string;
  /** بيبني حدث MemberInvited من الصف المقفول — نفس المعاملة، ومفيش فيه إيميل ولا رابط ولا token. */
  readonly buildEvent: (row: MemberInvitationRow, membershipId: string, userId: string) => DomainEvent;
  /** بيبني صفوف التدقيق من الصف المقفول بترتيب الكتابة. */
  readonly buildAudit: (
    row: MemberInvitationRow,
    membershipId: string,
    userId: string,
  ) => readonly AuditRecord[];
  readonly now: Date;
}

/** نتيجة الخطوة الثالثة: done false لما يكون فيه رفض جوه المعاملة (سلطة أو نطاق). */
export type CompleteInvitationOutcome =
  | {
      readonly done: true;
      readonly membershipId: string;
      readonly userId: string;
      /** true لما العضوية كانت اتكتبت في محاولة سابقة — التكرار بيرد بالحالة بدون كتابة. */
      readonly alreadyComplete: boolean;
    }
  | { readonly done: false; readonly refusal: MemberInvitationRefusal };

/** حدود جدول الدعوات — كل خطوة بتفتح معاملتها بنفسها (D6). */
export interface MemberInvitationTransactions {
  /**
   * الخطوة الأولى: يفحص سلطة المالك داخل المعاملة، ويفحص إن النطاق تابع للشركة، ويكتب صف
   * الدعوة بحالة PENDING؛ صف PENDING موجود بيتعاد استخدامه بس من نفس الداعي بنفس الدور
   * والنطاق، وأي اختلاف بيرفض (P1-b).
   *
   * @param input بيانات الدعوة
   * @returns معرّف الدعوة الجديد أو المعاد استخدامه، أو الرفض
   */
  open(input: OpenInvitationInput): Promise<OpenInvitationOutcome>;
  /**
   * الخطوة الثالثة: يعيد فحص سلطة المالك والنطاق جوه المعاملة، ويسجل العضوية والتدقيق
   * والحدث من الصف المقفول (P1-a).
   *
   * @param input بيانات الإتمام
   * @returns العضوية واليوزر اللي اتكتبوا، أو الرفض
   */
  complete(input: CompleteInvitationInput): Promise<CompleteInvitationOutcome>;
  /**
   * بيحجز إصدار رابط الدعوة مرة واحدة: تحديث ذري بيشترط إن الرابط لسه ما اتطلعش.
   *
   * @param input بيانات الحجز
   * @param input.companyId    الشركة
   * @param input.invitationId معرف الدعوة
   * @param input.at           وقت الحجز من الساعة المحقونة
   * @returns true لما الحجز يتم، وfalse لو رابط اتحجز قبل كده (فيه سباق أو انقطاع)
   */
  claimLink(input: { companyId: string; invitationId: string; at: Date }): Promise<boolean>;
  /**
   * يعيد فحص سلطة المالك جوه معاملة قافلة صف الدعوة، ويتأكد إن العضوية متكتبة واليوزر
   * موجود والحالة PENDING والدعوة من نفس المتصل، ويختم وقت الإصدار (P1-a، P1-c).
   *
   * @param input بيانات حجز الإعادة
   * @param input.companyId    الشركة
   * @param input.invitationId معرف الدعوة
   * @param input.actorUserId  المالك الفاعل
   * @param input.at           وقت الإصدار من الساعة المحقونة
   * @returns معرّف اليوزر اللي الرابط هيصدر له، أو الرفض
   */
  claimReissue(
    input: { companyId: string; invitationId: string; actorUserId: string; at: Date },
  ): Promise<{ readonly userId: string } | { readonly refusal: ReissueRefusal }>;
  /**
   * يختم وقت إصدار الرابط الناجح ويسجّل تدقيق «link.issued» بمعرّف الدعوة، من غير أي سر
   * (P2-a: الحجز بيثبت المحاولة، والختم بيثبت الإصدار الفعلي).
   *
   * @param input بيانات الختم
   * @param input.companyId    الشركة
   * @param input.invitationId معرف الدعوة
   * @param input.actorUserId  المالك الفاعل
   * @param input.at           وقت الإصدار من الساعة المحقونة
   */
  stampLink(input: {
    companyId: string;
    invitationId: string;
    actorUserId: string;
    at: Date;
  }): Promise<void>;
}

/** حدود جداول الهوية لعملية الدعوة — الخدمة الوحيدة اللي تقدر تلمس جداول Better Auth. */
export interface MemberAccounts {
  /**
   * بصمة الإيميل (HMAC) — الإيميل نفسه عمره ما بيتخزن في صف الدعوة ولا بيتبعت في log.
   *
   * @param email الإيميل زي ما الطلب جابه
   * @returns البصمة base64url
   */
  hashEmail(email: string): string;
  /**
   * يقول إن الإيميل تحت الدومين المحجوز لحسابات الموظفين (F1).
   *
   * @param email الإيميل زي ما الطلب جابه
   * @returns true لما يكون تحت الدومين المحجوز
   */
  isStaffEmail(email: string): boolean;
  /**
   * يقرأ حساب بالإيميل؛ null لو مفيش. تحت قرار N1 أي حساب موجود بيرفض الدعوة، فالقارئ ده
   * هو حكم الرفض مش باب إضافة عضوية.
   *
   * @param email الإيميل المنسّض
   * @returns الـ id وهل له كلمة مرور، أو null
   */
  findByEmail(email: string): Promise<{ userId: string; hasPassword: boolean } | null>;
  /**
   * ينشئ حساب المدعوّ بحساب دخول (من غير كلمة مرور) وعلامته؛ حساب مسبق بنفس الإيميل بيرجّع
   * createdByInvitation: false والطلب بيترد 422 فوق (P1-d).
   *
   * @param input بيانات الحساب
   * @param input.operationId معرّف عملية الدعوة
   * @param input.companyId   الشركة الداعية
   * @param input.email       الإيميل المنسّض
   * @param input.name        اسم العضو
   * @returns الـ id وهل الحساب اتعمل من الدعوة دي
   */
  createInvitedMember(input: {
    operationId: string;
    companyId: string;
    email: string;
    name: string;
  }): Promise<{ userId: string; createdByInvitation: boolean }>;
  /**
   * يصدر رابط تعيين كلمة مرور في معاملة واحدة تحت قفل صف اليوزر: يرفض لو اليوزر مش مدعوّ
   * من الشركة دي أو كلمة مروره اتحطت، ويبطل الروابط القديمة (P1-c).
   *
   * @param input بيانات الرابط
   * @param input.userId      يوزر الهوية
   * @param input.companyId   الشركة الطالبة
   * @param input.redirectTo  صفحة set-password
   * @param input.lifetimeMs  عمر الرابط (IM-Q3: 48 ساعة)
   * @param input.now         وقت الإصدار من الساعة المحقونة
   * @returns الرابط مرة واحدة — فيه token، فبيتسلم للطلب ولا يتكتبش في log
   */
  issueLink(input: {
    userId: string;
    companyId: string;
    redirectTo: string;
    lifetimeMs: number;
    now: Date;
  }): Promise<string>;
}

/** حدّ معدّل الدعوات لكل مالك في ساعة. */
export interface InvitationRateLimiter {
  /**
   * بيستهلك رصيد المالك، ويرفض الطلب لما الرصيد خلص.
   *
   * @param ownerUserId اليوزر اللي بيدعو
   * @returns true لما الطلب مسموح
   */
  allow(ownerUserId: string): Promise<boolean>;
}

/** رمز الحقن لمُعدّل الدعوات. */
export const INVITATION_RATE_LIMITER = Symbol('INVITATION_RATE_LIMITER');
