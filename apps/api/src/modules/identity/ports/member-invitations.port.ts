import type { AuditRecord } from '../../../shared/ports/audit-trail.port.ts';
import type { DomainEvent } from '../../../shared/ports/outbox-writer.port.ts';
import type { InvitationAssignment } from '../domain/invitable-roles.ts';
import type { InvitableRole, InvitationScopeType } from '../domain/invitable-roles.ts';
import type { OverrideTerms, permissionEditFailure } from '../domain/permission-edit.ts';
import type { overrideLifecycleFailure } from '../domain/permission-override-lifecycle.ts';

/** رفض متوقع في مسار الدعوة — الـ use case بيحوّله لكود خطأ معروف. */
export type MemberInvitationRefusal =
  | 'FORBIDDEN'
  | 'MEMBER_INVITATION_EXISTS'
  | 'MEMBER_ROLE_NOT_INVITABLE'
  | NonNullable<ReturnType<typeof permissionEditFailure>>
  | NonNullable<ReturnType<typeof overrideLifecycleFailure>>;

/** رفض إعادة إصدار الرابط: السلطة أو حالة الدعوة جوه المعاملة. */
export type ReissueRefusal =
  'FORBIDDEN' | 'MEMBER_INVITATION_NOT_REISSUEABLE' | 'MEMBER_ROLE_NOT_INVITABLE';

/** رفض إصدار رابط الدعوة من جهة الهوية — رسالته عامة وما بتكشفش سبب الرفض ولا وجود أي حساب. */
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
}

/** المتصل والشركة اللي بتتفحص سلطتها جوه كل معاملة كتابة. */
export interface InvitationActor {
  readonly companyId: string;
  readonly actorUserId: string;
}

/** عضوية واحدة بتتكتب مع الدعوة: المعرّف والدور والنطاق اللي بتاخدهم. */
export interface InvitedMembership {
  readonly membershipId: string;
  readonly roleCode: string;
  readonly scopeType: InvitationScopeType;
  readonly scopeId: string;
}

/** مدخلات الخطوة الأولى: السلطة والنطاق وصف الدعوة. */
export interface OpenInvitationInput extends InvitationActor {
  readonly invitationId: string;
  readonly emailHash: string;
  readonly roleCode: InvitableRole;
  readonly scope: InvitationScope;
  /** التوزيعات الإضافية («أدوار أكتر») — بتتحقق من نفس الشركة ونفس شرط النطاق. */
  readonly additionalAssignments: readonly InvitationAssignment[];
  readonly now: Date;
  /**
   * الحدّ اللي قبله الدعوة العالقة بتتحسب مهجورة: صف أقدم من الوقت ده ومفيش عليه طلب شغال،
   * فمالك تاني يقدر يرجّعه. اختياري: من غيره مفيش استرجاع، فالدعوة الشغالة أو القابلة
   * للاستئناف ما بتتلمسش.
   */
  readonly staleBefore?: Date | undefined;
  /**
   * معرّف العملية اللي أنشأت حساب الإيميل القائم (لو وُجد): لو يخالف صف الدعوة، الحساب معلّق
   * على عملية ماتت، فصف الدعوة ده ما بيستأنفش.
   */
  readonly accountOperationId?: string | undefined;
}

/** نتيجة الخطوة الأولى: صف الدعوة الجديد أو صف PENDING قديم اتعاد استخدامه بعد انقطاع (D6). */
export type OpenInvitationOutcome =
  { readonly invitationId: string } | { readonly refusal: MemberInvitationRefusal };

/** إلغاء دعوة عالقة قديمة: الداعي الحالي ودوره ونطاقه، وأي دعوة أقدم من `staleBefore` بتتحسب مهجورة. */
export interface StaleInvitationInput extends InvitationActor {
  /** معرّف العملية اللي أنشأت الحساب العالق — هو معرّف صف الدعوة. */
  readonly invitationId: string;
  readonly roleCode: InvitableRole;
  readonly scope: InvitationScope;
  /** التوزيعات الإضافية للدعوة الجديدة — بتلغيّ بس لو هي اتغيّرت. */
  readonly additionalAssignments: readonly InvitationAssignment[];
  /** دعوة أحدث من الوقت ده ممكن يكون عليها طلب شغال، فمبتتلغيش. */
  readonly staleBefore: Date;
}

/** مدخلات الإتمام: العضوية والتدقيق والحدث بتتبني من الصف المقفول مش من الطلب. */
export interface CompleteInvitationInput extends InvitationActor {
  readonly invitationId: string;
  readonly membershipId: string;
  /** اليوزر اللي الخطوة التانية أنشأته لهذه العملية؛ بيتطابق مع الصف المقفول أو الإتمام بيرفض. */
  readonly userId: string;
  /** التوزيعات الإضافية بعد إزالة المكرر — كل واحد بيفتح عضوية مستقلة في نفس المعاملة. */
  readonly additionalAssignments: readonly InvitationAssignment[];
  /** معرّفات العضويات الإضافية، بنفس ترتيب التوزيعات — بتتولّد من الـ IdGenerator قبل المعاملة. */
  readonly additionalMembershipIds: readonly string[];
  /** استثناءات الصلاحية المضمّنة («استثناء صلاحية») — بتكتب على أقرب عضوية صالحة. */
  readonly permissionOverrides: readonly OverrideTerms[];
  /** بيبني حدث MemberInvited من الصف المقفول — مفيش فيه إيميل ولا رابط ولا token. */
  readonly buildEvent: (
    row: MemberInvitationRow,
    membership: InvitedMembership,
    userId: string,
  ) => DomainEvent;
  /** بيبني صفوف التدقيق من الصف المقفول بترتيب الكتابة: حساب واحد وصف عضوية لكل عضوية. */
  readonly buildAudit: (
    row: MemberInvitationRow,
    memberships: readonly InvitedMembership[],
    userId: string,
  ) => readonly AuditRecord[];
  readonly now: Date;
}

/** نتيجة الإتمام: done false لما فيه رفض جوه المعاملة (سلطة أو نطاق أو صف مش متطابق). */
export type CompleteInvitationOutcome =
  | {
      readonly done: true;
      readonly membershipId: string;
      /** كل العضويات اللي اتكتبت (الأساسية والإضافية) — عشان إبطال كاش المنح بعد الـ commit. */
      readonly membershipIds: readonly string[];
      /** true لما العضوية اتكتبت في محاولة سابقة — بيرد بالحالة من غير كتابة ولا حدث. */
      readonly alreadyComplete: boolean;
    }
  | { readonly done: false; readonly refusal: MemberInvitationRefusal };

/** حجز إصدار الرابط الأول: الشركة والدعوة والمالك اللي بيحجز ووقت الحجز من الساعة المحقونة. */
export interface LinkClaimInput extends InvitationActor {
  readonly invitationId: string;
  readonly at: Date;
}

/** نتيجة حجز الرابط الأول: الحجز تم، أو سبب الرفض (سلطة اتسحبت، نطاق مش تابع، أو صف مش ماسك). */
export type LinkClaimOutcome =
  | { readonly claimed: true }
  | { readonly claimed: false; readonly refusal: MemberInvitationRefusal };

/** بيانات حساب المدعوّ: معرّف العملية (ايدمبوتنس) والشركة الداعية والإيميل والاسم. */
export interface InvitedAccountInput {
  readonly operationId: string;
  readonly companyId: string;
  readonly email: string;
  readonly name: string;
}

/** بيانات إصدار رابط تعيين كلمة المرور: اليوزر والشركة وصفحة set-password وعمر الرابط ووقت الإصدار. */
export interface LinkIssueInput {
  readonly userId: string;
  readonly companyId: string;
  readonly redirectTo: string;
  readonly lifetimeMs: number;
  readonly now: Date;
}

/** حدود جدول الدعوات — كل خطوة بتفتح معاملتها بنفسها (D6) وبتعيد فحص سلطة المالك جواها. */
export interface MemberInvitationTransactions {
  /**
   * فحص السلطة والنطاق قبل أي قراءة عن الإيميل، عشان رد «له حساب» ما يتسربش لغير المالك.
   *
   * @param input الفاعل والنطاق الأساسي والنطاقات الإضافية
   * @returns null لما مسموح، أو الرفض
   */
  authorize(
    input: InvitationActor & {
      scope: InvitationScope;
      additionalAssignments: readonly InvitationAssignment[];
    },
  ): Promise<MemberInvitationRefusal | null>;
  /**
   * الخطوة الأولى: السلطة والنطاق وكتابة صف PENDING مع تدقيق الفتح؛ صف PENDING موجود بيتعاد
   * استخدامه بس من نفس الداعي بنفس الدور والنطاق، وأي اختلاف بيرفض (P1-b). صف عالق من غير
   * حساب (وقف قبل إنشاء الحساب) وعدّى عليه الوقت بيتلغى تحت القفل، والدعوة الجديدة بتكمّل
   * مكانه (AC-ACT-20).
   *
   * @param input بيانات الدعوة
   * @returns معرّف الدعوة الجديد أو المعاد استخدامه، أو الرفض
   */
  open(input: OpenInvitationInput): Promise<OpenInvitationOutcome>;
  /**
   * بيسجّل رفض «الإيميل له حساب» (N1) بتدقيق من غير الإيميل — الرفض هو الإشارة الوحيدة
   * اللي بتكشف وجود الحساب، فلازم يتراجع.
   *
   * @param input الفاعل والشركة
   */
  recordRefusal(input: InvitationActor): Promise<void>;
  /**
   * بيلغي دعوة فتحناها ولسه ما اتكتبش لها يوزر ولا عضوية (خسرنا سباق إنشاء الحساب)، وبيسجّل التدقيق.
   *
   * @param input الفاعل ومعرف الدعوة
   */
  cancelOpened(input: InvitationActor & { invitationId: string }): Promise<void>;
  /**
   * بيلغي دعوة نفس المتصل اللي لسه ما اتكملتش بعد ما إتمامها اترفض (سلطة ضاعت أو نطاق اختفى)، عشان
   * الحساب اللي طلبه اتعمل ما يفضلش عالق من غير عضوية ولا رابط. تكرار آمن.
   *
   * @param input الفاعل ومعرف الدعوة
   * @returns true لما الدعوة ملغية ومفيش عضوية (حسابها يتمسح)، false لما اتكملت أو مش بتاعته
   */
  abandonOwn(input: InvitationActor & { invitationId: string }): Promise<boolean>;
  /**
   * بيلغي دعوة عالقة قديمة لحساب لسه من غير عضوية بطلب مالك حالي، تحت قفل صفها، ويمنع إتمامها؛ ما
   * بيلغيش اللي يقدر المتصل يكملها نفسه ولا الأحدث من `staleBefore`. تكرار آمن بعد انقطاع.
   *
   * @param input الداعي الحالي والعملية العالقة ونطاق الدعوة المطلوبة
   * @returns true لما الدعوة ملغية ومفيش عضوية (حسابها يتمسح)، false غير كده
   */
  abandonStale(input: StaleInvitationInput): Promise<boolean>;
  /**
   * الإتمام: بيعيد فحص السلطة والنطاق جوه المعاملة، ويكتب العضوية والتدقيق والحدث من الصف المقفول (P1-a).
   *
   * @param input بيانات الإتمام
   * @returns العضوية اللي اتكتبت، أو الرفض
   */
  complete(input: CompleteInvitationInput): Promise<CompleteInvitationOutcome>;
  /**
   * بيحجز إصدار الرابط الأول مرة واحدة جوه معاملة على مستوى الشركة: بيعيد فحص سلطة المالك
   * والنطاق ويمسك صف الدعوة، فسلطة اتسحبت بين الإتمام والحجز بترفض بدل ما الرابط يطلع
   * (AC-ACT-19). الحجز نفسه مش ختم الإصدار الفعلي (P2-a).
   *
   * @param input الشركة والدعوة والمالك ووقت الحجز
   * @returns claimed true لما الحجز يتم، أو claimed false مع سبب الرفض
   */
  claimLink(input: LinkClaimInput): Promise<LinkClaimOutcome>;
  /**
   * إعادة الإصدار: بيعيد فحص السلطة والنطاق جوه معاملة قافلة الصف، ويتأكد إن الدعوة PENDING
   * ومن نفس المتصل وعضويتها مكتوبة، ويسجّل تدقيق الطلب (P1-a، P2-a). الإصدار بيقفل خانة
   * الحجز الأول، فمفيش حجز جديد بعده (AC-ACT-19).
   *
   * @param input الفاعل ومعرف الدعوة
   * @returns يوزر الدعوة اللي الرابط هيصدر له، أو الرفض
   */
  claimReissue(
    input: InvitationActor & { invitationId: string },
  ): Promise<{ readonly userId: string } | { readonly refusal: ReissueRefusal }>;
  /**
   * بيختم وقت الإصدار الفعلي بعد كتابة التوكن، ويسجّل تدقيق «link.issued» بمعرّف الدعوة من غير أي سر.
   * وبيرسل بريد الدعوة لو الـ userId والرابط موجودين: الرابط بيتختم قبل ما يوصل للـ outbox.
   *
   * @param input الفاعل ومعرف الدعوة ووقت الإصدار
   * @param input.userId المستخدم المدعو، لو الدعوة ليها حساب
   * @param input.link رابط تعيين كلمة المرور، لو اتصدر
   * @param input.email إيميل المدعو، وقت ما الطلب لسه شايفه صريح
   */
  stampLink(
    input: InvitationActor & {
      invitationId: string;
      at: Date;
      userId?: string | undefined;
      link?: string | undefined;
      email?: string | undefined;
    },
  ): Promise<void>;
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
   * حال الإيميل لشركة داعية (قرار N1): أي حساب موجود بيرفض الدعوة، إلا حساب اتنشأ من دعوة
   * سابقة لنفس الشركة — ده بيسمح بالاستئناف بعد انقطاع.
   *
   * @param email الإيميل زي ما الطلب جابه
   * @param companyId الشركة الداعية
   * @returns FREE، أو TAKEN، أو OURS مع معرّف العملية اللي أنشأته
   */
  inspectEmail(
    email: string,
    companyId: string,
  ): Promise<{ kind: 'FREE' } | { kind: 'TAKEN' } | { kind: 'OURS'; operationId: string }>;
  /**
   * ينشئ حساب المدعوّ بحساب دخول من غير كلمة مرور وعلامته، بمعرّف العملية (ايدمبوتنس).
   *
   * @param input معرّف العملية والشركة والإيميل والاسم
   * @returns الـ id لو الحساب اتعمل من الدعوة دي، أو createdByInvitation false من غير id لما سبقنا حساب بنفس الإيميل
   */
  createInvitedMember(
    input: InvitedAccountInput,
  ): Promise<{ createdByInvitation: true; userId: string } | { createdByInvitation: false }>;
  /**
   * يمسح حساب اتنشأ من عملية دعوة اتلغت ومفيش لها عضوية، لو لسه من غير كلمة مرور. تكرار آمن.
   *
   * @param input معرّف العملية والشركة
   * @param input.operationId معرّف العملية اللي أنشأت الحساب (هو معرّف صف الدعوة)
   * @param input.companyId الشركة الداعية
   * @returns false لما الحساب له كلمة مرور فاتسابت
   */
  discardInvitedMember(input: { operationId: string; companyId: string }): Promise<boolean>;
  /**
   * يصدر رابط تعيين كلمة مرور بقفل صف اليوزر: يرفض لو اليوزر مش مدعوّ من الشركة دي أو
   * كلمة مروره اتحطت، ويبطل الروابط القديمة (P1-c).
   *
   * @param input اليوزر والشركة وصفحة set-password وعمر الرابط ووقت الإصدار
   * @returns الرابط مرة واحدة — فيه token، فبيتسلم للطلب ولا يتكتبش في log
   */
  issueLink(input: LinkIssueInput): Promise<string>;
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
