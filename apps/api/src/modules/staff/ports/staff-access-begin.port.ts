import type { StaffAccessBranchAssignment, StaffAccessRecordRow } from '../domain/staff-access.ts';

/** دورا إعطاء الدخول كما في عقد `grantStaffAccessInput` — النسخة المحلية لحدود الطبقات. */
export type StaffAccessRole = 'staff' | 'reception';

/** شروط استثناء صلاحية مضمّن في «إعطاء الدخول» (080-b) — نسخة محلية لحدود الطبقات. */
export interface StaffAccessOverrideTerms {
  /** كود الصلاحية. */
  readonly permission_code: string;
  /** أثر الاستثناء. */
  readonly effect: 'ALLOW' | 'DENY';
  /** نوع النطاق. */
  readonly scope_type: 'COMPANY' | 'BUSINESS' | 'BRANCH';
  /** معرّف النطاق. */
  readonly scope_id: string;
  /** سبب الاستثناء. */
  readonly reason: string;
  /** نهاية المدة أو null. */
  readonly expires_at: string | null;
}

/** مولّد UUID v7 — نفس شكل `IdGenerator` من @pospay/db بلا استيراد بنية تحتية في الطبقات الداخلية. */
export interface StaffAccessIds {
  /** يعيد معرّفاً جديداً فريداً. */
  newId(): string;
}

/** الشركة والمستخدم من الجلسة؛ المعاملات بتتفتح بالشركة دي والكتابة باسم المستخدم ده. */
export interface StaffAccessActor {
  /** الشركة من الجلسة. */
  readonly companyId: string;
  /** المانح أو القارئ من الجلسة. */
  readonly userId: string;
}

/** الموظفة بعد قفل صفها — الفرع الأساسي والنشاط هما هدفين فحص السلطة والعضوية. */
export interface StaffAccessEmployeeRow {
  /** معرّف الموظفة. */
  readonly id: string;
  /** نشاط الموظفة المحفوظ. */
  readonly businessId: string;
  /** الفرع الأساسي المحفوظ. */
  readonly primaryBranchId: string;
  /** المستخدم المرتبط أو null. */
  readonly userId: string | null;
  /** الاسم المعروض لاسم حساب الدخول. */
  readonly displayName: string;
}

/** طلب إعطاء الدخول بعد التحقق من العقد: الموظفة والدور المختار والهاتف والرقم السري. */
export interface GrantEmployeeAccessCommand extends StaffAccessActor {
  /** نشاط الموظفة من المسار. */
  readonly businessId: string;
  /** الموظفة من المسار. */
  readonly employeeId: string;
  /** الدور المختار من القايمة المقفولة. */
  readonly role: StaffAccessRole;
  /** الهاتف الكانوني المُقرّ من المانح. */
  readonly phone: string;
  /** الرقم السري المؤقت كما كتبه المانح. */
  readonly pin: string;
  /** إيميل الاستعادة الاختياري: لو اتبعت بيتسجل على الموظفة في نفس معاملة الخطوة الأولى. */
  readonly recoveryEmail?: string | null | undefined;
  /** فروع زيادة للموظفة بدورها (080-b): كل فرع بيتحول لعضوية مستقلة عند التفعيل. */
  readonly additionalBranches?: readonly StaffAccessBranchAssignment[] | undefined;
  /** استثناءات صلاحيات مضمّنة تُكتب مع العضويات في نفس المعاملة (080-b). */
  readonly permissionOverrides?: readonly StaffAccessOverrideTerms[] | undefined;
}

/** ناتج الخطوة الأولى: السجل المُعاد استخدامه أو المُنشأ، واسم الموظفة وفرعها الأساسي. */
export interface GrantBeginOutcome {
  /** سجل الدخول بعد الخطوة. */
  readonly record: StaffAccessRecordRow;
  /** الموظفة بعد القفل. */
  readonly employee: StaffAccessEmployeeRow;
}

/**
 * ناتج الخطوة الثالثة: عضوية جديدة اتعملت، أو تكرار بعد نجاح سابق لا يكتب شيئاً. الدور والفرع
 * من السجل المقفول، ليُبنى الرد بلا قراءة تالية بعد الالتزام (فلا يصير نجاح ملتزم 500).
 */
export type GrantCommitOutcome =
  | {
      readonly kind: 'granted';
      readonly membershipId: string;
      /** عضويات الفروع الإضافية الممنوحة (080-b) — تُبطَل كاش المنح على كل واحدة. */
      readonly extraMembershipIds: readonly string[];
      readonly userId: string;
      readonly role: StaffAccessRole;
      readonly branchId: string;
    }
  | {
      readonly kind: 'already';
      readonly role: StaffAccessRole;
      readonly branchId: string;
      /** هل هاتف السجل هو هاتف هذا الطلب؟ */
      readonly phoneMatches: boolean;
    };

/**
 * نطاق الخطوة الأولى داخل معاملة الشركة: قفل الشركة ثم الموظفة وفحص السلطة وإنشاء سجل الانتظار
 * أو قراءته. كل دالة بتكتب صفوف التدقيق الخاصة بيها قبل ما ترجع.
 */
export interface GrantBeginScope {
  /** يقفل الشركة النشطة أولًا بترتيب أقفال الكتابة الموحد (P1-3)؛ false لشركة محذوفة. */
  lockCompany(): Promise<boolean>;
  /**
   * يقفل صف الموظفة FOR UPDATE ويرجعه؛ null لموظفة محذوفة أو غريبة عن النشاط.
   */
  lockEmployee(): Promise<StaffAccessEmployeeRow | null>;
  /**
   * يفحص `manage:staff-access:branch` على فرع الموظفة الأساسي جوه نفس المعاملة (FR-F1-3).
   *
   * @param businessId النشاط
   * @param branchId   الفرع الأساسي المقفول
   */
  authority(businessId: string, branchId: string): Promise<boolean>;
  /** يقرأ سجل الدخول للموظفة إن وُجد بلا قفل إضافي. */
  findRecord(): Promise<StaffAccessRecordRow | null>;
  /**
   * يقرأ الفروع الإضافية المحفوظة للسجل القفول (080-b) عشان استئناف الطلب يطابق السجل.
   *
   * @param recordId سجل الدخول
   */
  findExtraBranches(recordId: string): Promise<readonly StaffAccessBranchAssignment[]>;
  /**
   * يسجّل إيميل الاستعادة المطبّع على الموظفة المقفولة؛ التكرار داخل الشركة يرفع EMPLOYEE_RECOVERY_EMAIL_TAKEN.
   *
   * @param email الإيميل المطبّع
   */
  setRecoveryEmail(email: string): Promise<void>;
  /** يثبت الهاتف والدور والفرع عند إعادة منح سجل متوقف قبل إنشاء أي أثر هوية، ويبدأ محاولة جديدة
   * بمعرّف محاولة جديد ولحظة بداية جديدة (P1-1/P1-3).
   *
   * @param recordId السجل المتوقف
   * @param input tuple الطلب الجديد
   * @param input.phoneHash بصمة الهاتف
   * @param input.roleCode الدور المختار
   * @param input.branchId الفرع الأساسي
   * @param input.extraBranches الفروع الإضافية الجديدة
   */
  restartRecord(
    recordId: string,
    input: {
      phoneHash: string;
      roleCode: StaffAccessRole;
      branchId: string;
      /** الفروع الإضافية الجديدة — الصفوف القديمة بتتشال وبتتدقيق أولاً (080-b). */
      extraBranches?: readonly StaffAccessBranchAssignment[] | undefined;
    },
  ): Promise<StaffAccessRecordRow>;
  /**
   * يحرر محاولة المنح الحالية بعد رفض هاتف مملوك مؤكد: سجل بلا مستخدم يُحذف، وسجل إعادة منح يعود
   * STOPPED، وكلاهما بشرط أن المحاولة ما زالت هي نفسها ويكتب التدقيق. false لو تغيّر السجل.
   *
   * @param recordId  السجل المقفول
   * @param attemptId المحاولة التي رُفضت
   */
  releaseAttempt(recordId: string, attemptId: string): Promise<boolean>;
  /**
   * hash الهاتف الكانوني — المقارنة عند الاستئناف بلا كشف الهاتف (P1-4).
   *
   * @param phone الهاتف الكانوني كما كتبه المانح
   */
  phoneHash(phone: string): string;
  /**
   * ينشئ سجل الانتظار بمعرّف عملية جديد مع تدقيق الإنشاء.
   *
   * @param input بيانات السجل الجديد
   * @param input.roleCode الدور المختار
   * @param input.branchId الفرع الأساسي للسجل
   * @param input.phoneHash hash الهاتف المطلوب
   * @param input.extraBranches الفروع الإضافية المطلوبة
   */
  insertRecord(input: {
    roleCode: StaffAccessRole;
    branchId: string;
    phoneHash: string;
    /** الفروع الإضافية المطلوبة — بتكتب مع السجل في نفس المعاملة (080-b). */
    extraBranches?: readonly StaffAccessBranchAssignment[] | undefined;
  }): Promise<StaffAccessRecordRow>;
}
