import type { AuditRecord } from '../../../shared/ports/audit-trail.port.ts';
import type { DomainEvent } from '../../../shared/ports/outbox-writer.port.ts';
import type { InvitableRole, InvitationScopeType } from '../domain/invitable-roles.ts';

/** رفض متوقع في مسار الدعوة — الـ use case بيحوّله لكود خطأ معروف. */
export type MemberInvitationRefusal =
  | 'FORBIDDEN'
  | 'MEMBER_ALREADY_IN_COMPANY'
  | 'MEMBER_INVITATION_EXISTS'
  | 'MEMBER_ROLE_NOT_INVITABLE';

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

/** نتيجة الخطوة الأولى: صف الدعوة الجديد، أو صف PENDING قديم اتجدد لطلب مكرر بعد انقطاع (D6). */
export type OpenInvitationOutcome =
  | { readonly invitationId: string }
  | { readonly refusal: MemberInvitationRefusal };

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
  /** صفوف التدقيق بترتيب الكتابة — الـ use case بيعرف إيه اللي يتسجل، والـ SQL عند الـ adapter. */
  readonly audit: readonly AuditRecord[];
  /** حدث MemberInvited جاهز للـ outbox — نفس المعاملة، ومفيش فيه إيميل ولا رابط ولا token. */
  readonly event: DomainEvent;
  readonly now: Date;
}

/** نتيجة الخطوة الثالثة: done false لما يكون في عضوية سارية فالدعوة بتتلف. */
export type CompleteInvitationOutcome =
  | {
      readonly done: true;
      /** true لما العضوية كانت اتكتبت في محاولة سابقة انقطعت — التكرار بيرد بالحالة بدون كتابة. */
      readonly alreadyComplete: boolean;
      /** آخر ماعة الرابط اتطلع؛ null لما الرابط لسه ما اتطلعش، فالتكرار بعد انقطاع بيطلعه. */
      readonly linkIssuedAt: Date | null;
    }
  | { readonly done: false };

/** حدود جدول الدعوات — كل خطوة بتفتح معاملتها بنفسها (D6). */
export interface MemberInvitationTransactions {
  /**
   * الخطوة الأولى: يفحص سلطة المالك داخل المعاملة، ويفحص إن النطاق تابع للشركة، ويكتب صف
   * الدعوة بحالة PENDING؛ صف PENDING موجود لنفس الإيميل بيتعاد استخدامه بمعرّفه.
   *
   * @param input بيانات الدعوة
   * @param input.companyId      الشركة
   * @param input.actorUserId    المالك اللي بيدعو
   * @param input.invitationId   معرّف الدعوة المقترح
   * @param input.emailHash      بصمة الإيميل المدعوّ
   * @param input.roleCode       كود الدور
   * @param input.scope          نطاق العضوية
   * @param input.existingUserId اليوزر الموجود مسبقاً أو null
   * @param input.now            وقت الطلب من الساعة المحقونة
   * @returns معرّف الدعوة الجديد أو المعاد استخدامه، أو الرفض
   */
  open(input: OpenInvitationInput): Promise<OpenInvitationOutcome>;
  /**
   * الخطوة الثالثة: يتأكد إن مفيش عضوية سارية لنفس اليوزر، ويسجل العضوية والتدقيق والحدث.
   *
   * @param input بيانات الإتمام
   * @param input.companyId    الشركة
   * @param input.actorUserId  المالك الفاعل
   * @param input.invitationId معرّف الدعوة
   * @param input.userId       اليوزر المدعوّ
   * @param input.membershipId معرّف العضوية الجديدة
   * @param input.roleCode     كود الدور
   * @param input.scope        نطاق العضوية
   * @param input.createdByInvitation هل الحساب اتعمل من الدعوة دي
   * @param input.audit        صفوف التدقيق
   * @param input.event        حدث MemberInvited
   * @param input.now          وقت الطلب من الساعة المحقونة
   * @returns حالة الإتمام؛ عضوية سارية بتلفّ الدعوة وترجّع done false
   */
  complete(input: CompleteInvitationInput): Promise<CompleteInvitationOutcome>;
  /**
   * يقرأ صف الدعوة في الشركة.
   *
   * @param input الشركة ومعرف الدعوة
   * @param input.companyId    الشركة
   * @param input.invitationId معرف الدعوة
   * @returns صف الدعوة، أو null لما مفيش دعوة بالمعرف ده في الشركة
   */
  read(input: { companyId: string; invitationId: string }): Promise<MemberInvitationRow | null>;
  /**
   * يختم وقت إصدار الرابط.
   *
   * @param input الشركة ومعرف الدعوة والوقت
   * @param input.companyId    الشركة
   * @param input.invitationId معرف الدعوة
   * @param input.at           وقت الإصدار من الساعة المحقونة
   * @returns بيخلص لما الوقت يتكتب
   */
  stampLink(input: { companyId: string; invitationId: string; at: Date }): Promise<void>;
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
   * يقرأ حساب بالإيميل؛ null لو مفيش.
   *
   * @param email الإيميل المنسّض
   * @returns الـ id وهل له كلمة مرور، أو null
   */
  findByEmail(email: string): Promise<{ userId: string; hasPassword: boolean } | null>;
  /**
   * يقرأ اليوزر اللي اتعمل من عملية دعوة معيّنة في الشركة دي؛ null لو مفيش.
   *
   * @param operationId معرّف عملية الدعوة (= معرّف الدعوة)
   * @param companyId   الشركة الداعية
   * @returns الـ id وهل له كلمة مرور، أو null
   */
  findByInvitation(
    operationId: string,
    companyId: string,
  ): Promise<{ userId: string; hasPassword: boolean } | null>;
  /**
   * ينشئ حساب المدعوّ بحساب دخول (من غير كلمة مرور) وعلامته، أو بيرجّع الحساب الموجود.
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
   * يقرأ علامة الدعوة على اليوزر: الشركة اللي دعته وهل كلمة المرور اتحطت.
   *
   * @param userId يوزر الهوية
   * @returns علامة الدعوة، أو null لما مفيش يوزر
   */
  readMarker(
    userId: string,
  ): Promise<{ invitedByCompanyId: string | null; hasPassword: boolean } | null>;
  /**
   * يصدر رابط تعيين كلمة مرور — بس لليوزر اللي دعته الشركة دي واللي مالوش كلمة مرور.
   *
   * @param input بيانات الرابط
   * @param input.userId      يوزر الهوية
   * @param input.companyId   الشركة الطالبة
   * @param input.redirectTo  صفحة set-password
   * @param input.lifetimeMs  عمر الرابط؛ غيابه يعني ساعة
   * @param input.now         وقت الإصدار من الساعة المحقونة
   * @returns الرابط مرة واحدة — فيه token فبيتسلم للطلب ولا يتكتبش
   */
  issueInvitationLink(input: {
    userId: string;
    companyId: string;
    redirectTo: string;
    lifetimeMs?: number;
    now?: Date;
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
