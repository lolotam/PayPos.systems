import type { StaffAccessRecordRow } from '../domain/staff-access.ts';

/** دورا إعطاء الدخول كما في عقد `grantStaffAccessInput` — النسخة المحلية لحدود الطبقات. */
export type StaffAccessRole = 'staff' | 'reception';

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
}

/** ناتج الخطوة الأولى: السجل المُعاد استخدامه أو المُنشأ، واسم الموظفة وفرعها الأساسي. */
export interface GrantBeginOutcome {
  /** سجل الدخول بعد الخطوة. */
  readonly record: StaffAccessRecordRow;
  /** الموظفة بعد القفل. */
  readonly employee: StaffAccessEmployeeRow;
}

/** ناتج الخطوة الثالثة: عضوية جديدة اتعملت، أو تكرار بعد نجاح سابق لا يكتب شيئاً. */
export type GrantCommitOutcome =
  | { readonly kind: 'granted'; readonly membershipId: string; readonly userId: string }
  | { readonly kind: 'already' };

/**
 * نطاق الخطوة الأولى داخل معاملة الشركة: قفل الموظفة وفحص السلطة وإنشاء سجل الانتظار أو قراءته.
 * كل دالة بتكتب صفوف التدقيق الخاصة بيها قبل ما ترجع.
 */
export interface GrantBeginScope {
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
   * ينشئ سجل الانتظار بمعرّف عملية جديد مع تدقيق الإنشاء.
   *
   * @param input بيانات السجل الجديد
   * @param input.roleCode الدور المختار
   * @param input.branchId الفرع الأساسي للسجل
   */
  insertRecord(input: { roleCode: StaffAccessRole; branchId: string }): Promise<StaffAccessRecordRow>;
}

/**
 * نطاق الخطوة الثالثة داخل معاملة الشركة: إعادة الفحص تحت القفل ثم العضوية والربط والرقم المؤقت
 * والتدقيق والحدث — كله في معاملة واحدة فلا حالة جزئية أبداً.
 */
export interface GrantCommitScope {
  /** يقفل الشركة النشطة أولاً بترتيب أقفال PR 7؛ false لشركة محذوفة فيوقف الخطوة. */
  lockCompany(): Promise<boolean>;
  /**
   * يعيد قراءة السجل والموظفة تحت القفل لإعادة فحص الخطوة الأولى بعد انتظار الخطوة الثانية.
   */
  recheck(): Promise<{
    employee: StaffAccessEmployeeRow | null;
    record: StaffAccessRecordRow | null;
  }>;
  /**
   * نفس فحص السلطة جوه المعاملة الجديدة.
   *
   * @param businessId النشاط
   * @param branchId   الفرع الأساسي
   */
  authority(businessId: string, branchId: string): Promise<boolean>;
  /**
   * يفتح عضوية الفرع بدور النظام من جدول identity ويسجل تدقيقها.
   *
   * @param input بيانات العضوية الجديدة
   * @param input.userId المستخدم المستهدف
   * @param input.branchId الفرع الأساسي
   * @param input.role الدور المختار
   */
  grantMembership(input: {
    userId: string;
    branchId: string;
    role: StaffAccessRole;
  }): Promise<{ membershipId: string }>;
  /**
   * يربط الموظفة بمستخدم الدخول ويرفع revision ويسجل التدقيق (FR-F1-4).
   *
   * @param userId المستخدم الجديد للربط
   */
  linkEmployee(userId: string): Promise<void>;
  /**
   * يحفظ الرقم السري كمؤقت ينتهي بعد 24 ساعة ويسجل التدقيق بلا أي رقم ظاهر.
   *
   * @param userId  صاحب الرقم
   * @param pinHash الـ hash الجاهز من packages/auth
   */
  saveTemporaryPin(userId: string, pinHash: string): Promise<void>;
  /**
   * يحوّل السجل إلى ACTIVE بمعرّفي المستخدم والعضوية (BR-1).
   *
   * @param input معرّفات التفعيل
   * @param input.recordId معرّف السجل
   * @param input.userId المستخدم المؤكد
   * @param input.membershipId العضوية المُنشأة
   */
  markActive(input: { recordId: string; userId: string; membershipId: string }): Promise<void>;
  /**
   * يكتب حدث StaffAccessGranted في الـ outbox جوه نفس المعاملة — بلا هاتف ولا رقم سري في الحمولة.
   *
   * @param payload معرّفات الحدث
   * @param payload.employeeId الموظفة
   * @param payload.userId المستخدم
   * @param payload.membershipId العضوية
   * @param payload.branchId الفرع
   * @param payload.role الدور
   */
  appendEvent(payload: {
    employeeId: string;
    userId: string;
    membershipId: string;
    branchId: string;
    role: StaffAccessRole;
  }): Promise<void>;
}

/**
 * خطوات إعطاء الدخول: الخطوة الأولى والثالثة كل واحدة معاملة شركة مستقلة، والفاصل بينهم خطوة auth
 * لا يمكن جمعها معهما في معاملة واحدة (FR-F1-6، قرار D6).
 */
export interface GrantEmployeeAccessSteps {
  /**
   * يفتح معاملة الخطوة الأولى بفضل المستخدم ويشغّل الشغل داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الخطوة
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.ids مولّد المعرّفات
   * @param input.at لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  begin<T>(
    actor: StaffAccessActor,
    input: { businessId: string; employeeId: string; ids: StaffAccessIds; at: Date },
    work: (scope: GrantBeginScope) => Promise<T>,
  ): Promise<T>;
  /**
   * يفتح معاملة الخطوة الثالثة ويشغّل الشغل داخلها؛ أي رفض يرجّع كل ما كُتب داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الخطوة
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.recordId السجل المستأنَف
   * @param input.ids مولّد المعرّفات
   * @param input.at لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  commit<T>(
    actor: StaffAccessActor,
    input: {
      businessId: string;
      employeeId: string;
      recordId: string;
      ids: StaffAccessIds;
      at: Date;
    },
    work: (scope: GrantCommitScope) => Promise<T>,
  ): Promise<T>;
}

/**
 * خطوة المستخدم على pospay_auth مع تصوير الرقم السري — الجسر الوحيد بين staff وpackages/auth.
 */
export interface StaffAccessUserSteps {
  /**
   * ينشئ مستخدم الموظفة أو يجيده بمعرّف العملية (الخطوة الثانية)، ويرفض هاتفاً مملوكاً لغيره.
   *
   * @param input نطاق الإنشاء
   * @param input.operationId معرّف العملية من السجل
   * @param input.companyId الشركة
   * @param input.actorUserId المانح المؤكِّد للهاتف
   * @param input.phone الهاتف الكانوني
   * @param input.name اسم الموظفة
   * @param input.ids مولّد المعرّفات
   */
  provision(input: {
    operationId: string;
    companyId: string;
    actorUserId: string;
    phone: string;
    name: string;
    ids: StaffAccessIds;
  }): Promise<{ userId: string }>;
  /**
   * يصوّر الرقم السري قبل المعاملة الثالثة — الـ hashing بطيء مقصود فلا يُنتظر داخل قفل صف.
   *
   * @param pin الرقم السري كما كُتب
   */
  hash(pin: string): Promise<string>;
}

/**
 * إبطال كاش المنح بعد الالتزام (الخطوة الرابعة بعد commit) — الجلسات القديمة تعرف عضويتها الجديدة.
 */
export interface StaffAccessGrantCache {
  /**
   * يرفع إصدار الكاش للشركة وللعضوية الجديدة.
   *
   * @param input نطاق الإبطال
   * @param input.companyId الشركة
   * @param input.membershipId العضوية الجديدة
   */
  invalidate(input: { companyId: string; membershipId: string }): Promise<void>;
}

/** نطاق إلغاء سجل الانتظار داخل معاملة الشركة: القراءة تحت القفل ثم الحذف مع التدقيق. */
export interface CancelPendingScope {
  /**
   * يقفل صف الموظفة وسجل الدخول ويرجعهما؛ null لموظفة أو سجل غير موجود.
   */
  lock(): Promise<{
    employee: StaffAccessEmployeeRow | null;
    record: StaffAccessRecordRow | null;
  }>;
  /**
   * فحص `manage:staff-access:branch` على فرع الموظفة الأساسي جوه نفس المعاملة.
   *
   * @param businessId النشاط
   * @param branchId   الفرع الأساسي
   */
  authority(businessId: string, branchId: string): Promise<boolean>;
  /**
   * يحذف سجل الانتظار ويسجل الإلغاء — الحساب نفسه يُحذف قبله في معاملة auth مستقلة، والشرط
   * `state='PENDING'` يمنع حذف سجل اكتمل منحه في السباق بين الخطوتين.
   *
   * @param recordId معرّف السجل الملغى
   * @returns true لو اتحذف فعلاً، وfalse لو السجل لم يعد PENDING
   */
  deleteRecord(recordId: string): Promise<boolean>;
}

/**
 * معاملة إلغاء سجل الانتظار: الحذف داخل تراجع واحد بعد حذف الحساب في auth.
 */
export interface CancelPendingStaffAccessSteps {
  /**
   * يفتح معاملة الإلغاء ويشغّل الشغل داخلها.
   *
   * @param actor الشركة والمانح
   * @param input نطاق الإلغاء
   * @param input.businessId النشاط
   * @param input.employeeId الموظفة
   * @param input.ids مولّد المعرّفات
   * @param input.at لحظة الساعة المحقونة
   * @param work الشغل داخل المعاملة
   */
  run<T>(
    actor: StaffAccessActor,
    input: { businessId: string; employeeId: string; ids: StaffAccessIds; at: Date },
    work: (scope: CancelPendingScope) => Promise<T>,
  ): Promise<T>;
}
