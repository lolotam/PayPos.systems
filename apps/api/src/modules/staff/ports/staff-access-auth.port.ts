/**
 * واجهة حساب الموظفة كما يحتاجها staff عبر identity (نفس شكل `StaffUserFacade` في identity):
 * الإنشاء والإيجاد والإلغاء بمعرّف العملية فقط، ومفيش أي مسار تعامل (D8). النوع محلي لأن
 * module wiring ما بيستوردش أنواعاً من موديول تاني.
 */

/** مدخل الإنشاء أو الإيجاد. */
export interface StaffAccessProvisionInput {
  /** معرّف العملية من سجل الدخول. */
  readonly operationId: string;
  /** الشركة. */
  readonly companyId: string;
  /** المانح المؤكِّد للهاتف. */
  readonly actorUserId: string;
  /** الهاتف الكانوني. */
  readonly phone: string;
  /** اسم الموظفة. */
  readonly name: string;
  /** مولّد UUID v7. */
  readonly ids: { newId(): string };
}

/** مدخل الإلغاء. */
export interface StaffAccessCancelInput {
  /** معرّف العملية. */
  readonly operationId: string;
  /** الشركة. */
  readonly companyId: string;
  /** المانح الملغي. */
  readonly actorUserId: string;
  /** مولّد UUID v7 لصف التدقيق. */
  readonly ids: { newId(): string };
}

/** واجهة حساب الموظفة كما يراها staff. */
export interface AuthFacadeForStaffAccess {
  /**
   * ينشئ مستخدم الموظفة أو يجيده بمعرّف العملية.
   *
   * @param input مدخل الإنشاء
   */
  provision(input: StaffAccessProvisionInput): Promise<{ userId: string }>;
  /**
   * يحذف مستخدم الموظفة عند إلغاء سجل انتظار.
   *
   * @param input مدخل الإلغاء
   */
  cancel(input: StaffAccessCancelInput): Promise<void>;
  /**
   * يقرأ المستخدم بمعرّف العملية للعرض.
   *
   * @param operationId معرّف العملية
   */
  read(operationId: string): Promise<{ userId: string; phoneLast3: string | null } | null>;
}
