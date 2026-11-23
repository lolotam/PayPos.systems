import type { InvitableRole, InvitationScopeType } from '../domain/invitable-roles.ts';

/** أكواد الرفض المتوقعة في مسار الدعوة؛ الـ API بيحوّلها لأكواد خطأ معروفة. */
export type MemberInvitationErrorCode =
  | 'FORBIDDEN'
  | 'MEMBER_ALREADY_IN_COMPANY'
  | 'MEMBER_INVITATION_EXISTS'
  | 'MEMBER_ROLE_NOT_INVITABLE'
  | 'MEMBER_INVITATION_NOT_REISSUEABLE';

/** رفض متوقع في مسار الدعوة — مش خطأ خادم. */
export class MemberInvitationError extends Error {
  override readonly name = 'MemberInvitationError';
  readonly code: MemberInvitationErrorCode;

  constructor(code: MemberInvitationErrorCode) {
    super(code);
    this.code = code;
  }
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
  /** اليوزر الموجود مسبقاً (لو كان للإيميل حساب)، عشان نفحص عضوية سارية قبل الكتابة. */
  readonly existingUserId: string | null;
  readonly now: Date;
}

/** مدخلات الخطوة الثالثة: العضوية والتدقيق والحدث. */
export interface CompleteInvitationInput {
  readonly companyId: string;
  readonly actorUserId: string;
  readonly invitationId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly roleCode: InvitableRole;
  readonly scope: InvitationScope;
  /** true لما الحساب اتعمل من الدعوة دي — ساعتها الدعوة تفضل PENDING لحد ما يحط كلمة مروره. */
  readonly createdByInvitation: boolean;
  readonly now: Date;
}

/** حدود جدول الدعوات — كل خطوة بتفتح معاملتها بنفسها (D6). */
export interface MemberInvitationTransactions {
  /**
   * الخطوة الأولى: يفحص سلطة المالك داخل المعاملة، ويفحص إن النطاق تابع للشركة، ويكتب
   * صف الدعوة بحالة PENDING.
   *
   * @param input الشركة والفاعل والدعوة والبصمة والدور والنطاق والحساب الموجود
   * @returns بيخلص لما صف الدعوة يتكتب
   */
  open(input: OpenInvitationInput): Promise<void>;
  /**
   * الخطوة الثالثة: يتأكد إن مفيش عضوية سارية لنفس اليوزر، ويسجل العضوية والتدقيق والحدث.
   *
   * @param input الشركة والفاعل والدعوة واليوزر والعضوية والدور والنطاق
   * @returns ok false لما يكون في عضوية سارية، فالدعوة بتتلفّ والدعوة بترفض
   */
  complete(input: CompleteInvitationInput): Promise<{ readonly ok: boolean }>;
  /**
   * يقرأ صف الدعوة في الشركة.
   *
   * @param input الشركة ومعرف الدعوة
   * @returns صف الدعوة، أو null لما مفيش دعوة بالمعرف ده في الشركة
   */
  read(input: { companyId: string; invitationId: string }): Promise<MemberInvitationRow | null>;
  /**
   * يختم وقت إصدار الرابط.
   *
   * @param input الشركة ومعرف الدعوة والوقت
   * @returns بيخلص لما الوقت يتكتب
   */
  stampLink(input: { companyId: string; invitationId: string; at: Date }): Promise<void>;
}

/** حدود جداول الهوية لعملية الدعوة — الخدمة الوحيدة اللي تقدر تلمس جداول Better Auth. */export interface MemberAccounts {
  /** بصمة الإيميل (HMAC) — الإيميل نفسه عمره ما بيتخزن ولا بيتبعت في log. */
  hashEmail(email: string): string;
  /** يقرأ حساب بالإيميل؛ null لو مفيش. */
  findByEmail(email: string): Promise<{ userId: string; hasPassword: boolean } | null>;
  /** يقرأ اليوزر اللي اتعمل من عملية دعوة معيّنة في الشركة دي؛ null لو مفيش. */
  findByInvitation(
    operationId: string,
    companyId: string,
  ): Promise<{ userId: string; hasPassword: boolean } | null>;
  /** ينشئ حساب المدعوّ بحساب دخول (من غير كلمة مرور) وعلامته، أو بيرجّع الحساب الموجود. */
  createInvitedMember(input: {
    operationId: string;
    companyId: string;
    email: string;
    name: string;
  }): Promise<{ userId: string; createdByInvitation: boolean }>;
  /** يقرأ علامة الدعوة على اليوزر: الشركة اللي دعته وهل كلمة المرور اتحطت. */
  readMarker(userId: string): Promise<{ invitedByCompanyId: string | null; hasPassword: boolean } | null>;
  /** يصدر رابط تعيين كلمة مرور — بس لليوزر اللي دعته الشركة دي واللي مالوش كلمة مرور. */
  issueInvitationLink(input: {
    userId: string;
    companyId: string;
    redirectTo: string;
    lifetimeMs?: number;
    now?: Date;
  }): Promise<string>;
}

/** بيقول إن اليوزر حط كلمة مروره — بيستعمله لعرض حالة الدعوة. */
export type MemberPasswordState = (userId: string) => Promise<boolean>;

/** رمز الحقن لقراءة حالة كلمة المرور من جداول الهوية. */
export const MEMBER_PASSWORD_STATE = Symbol('MEMBER_PASSWORD_STATE');

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
