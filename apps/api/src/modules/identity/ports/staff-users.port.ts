import type { IdGenerator } from '@pospay/db';

/**
 * واجهة خطوة المستخدم على pospay_auth (ADR-0003 §4): الحساب يتعلم أو يتمسح بمعرّف العملية فقط،
 * ولا مسار تعامل (credential) بيتفتح له أبداً. التنفيذ الحقيقي على AuthService في packages/auth،
 * وidentity هو المدخل الوحيد له — staff بيوصل له من خلال الدوال المصدَّرة في index.ts.
 */

/** مدخل إنشاء مستخدم الموظفة أو إيجاده مرة أخرى بمعرّف العملية. */
export interface StaffUserProvisionInput {
  /** معرّف العملية من سجل الدخول — هوية الاستئناف لكل الخطوات (FR-F1-6). */
  readonly operationId: string;
  /** شركة السجل؛ الماركر بيربط الحساب بيها ولا يعود أبداً لشركة ثانية. */
  readonly companyId: string;
  /** الهاتف الكانوني المطلوب ربطه بالموافقة؛ رقم مملوك لأي مستخدم آخر يُرفض. */
  readonly phone: string;
  /** اسم الموظفة كما يظهر في حساب الدخول. */
  readonly name: string;
  /** المانح المُؤكِّد للهاتف — بيتسجل في تدقيق المنصة (قرار D2). */
  readonly actorUserId: string;
  /** مولّد UUID v7 لصفوف المنصة. */
  readonly ids: IdGenerator;
}

/** ناتج الخطوة الثانية: معرف المستخدم الموجود أو المُنشأ حديثاً. */
export interface StaffUserProvisioned {
  readonly userId: string;
}

/** مدخل إلغاء سجل انتظار: حذف مستخدم الموظفة بمعرّف العملية المرتبط بنفس الشركة. */
export interface StaffUserCancelInput {
  readonly operationId: string;
  readonly companyId: string;
}

/** حالة مستخدم الموظفة للقراءة: المعرف وآخر ثلاثة أرقام من الهاتف فقط — لا هاتف كامل ولا بريد. */
export interface StaffUserRead {
  readonly userId: string;
  readonly phoneLast3: string | null;
}

/**
 * واجهة packages/auth كما يراها identity: كل مسارات التعامل (credential) لمستخدم الموظفة مقفولة
 * في نفس المكان (D8)، والقراءة بالمعرّف لا ترجّع بيانات حساسة.
 */
export interface StaffUserFacade {
  /**
   * يُنشئ مستخدم الموظفة أو يجيده بمعرّف العملية في معاملة auth واحدة (الخطوة 2).
   *
   * @param input معرّف العملية والشركة والهاتف والاسم والمانح
   * @returns معرف المستخدم بعد الإنشاء أو الإيجاد، ورفض الهاتف المملوك غيره
   */
  provisionStaffUser(input: StaffUserProvisionInput): Promise<StaffUserProvisioned>;
  /**
   * يحذف مستخدم الموظفة بمعرّف العملية (إلغاء سجل انتظار متجاوز للمدة).
   *
   * @param input معرّف العملية وشركته — حساب شركة أخرى لا يُلمس
   */
  cancelStaffUser(input: StaffUserCancelInput): Promise<void>;
  /**
   * يقرأ مستخدم الموظفة بمعرّف العملية للعرض.
   *
   * @param operationId معرّف العملية
   * @returns المعرف وآخر ثلاثة أرقام من الهاتف، أو null لما مفيش حساب
   */
  readStaffUser(operationId: string): Promise<StaffUserRead | null>;
}
