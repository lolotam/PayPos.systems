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
   */
  insertRecord(input: {
    roleCode: StaffAccessRole;
    branchId: string;
    phoneHash: string;
  }): Promise<StaffAccessRecordRow>;
}
