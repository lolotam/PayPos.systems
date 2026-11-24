import type { IdGenerator } from '@pospay/db';

/**
 * واجهة حساب الموظفة كما يحتاجها staff عبر identity — بنفس شكل `StaffUserFacade` في identity
 * (الإنشاء والإيجاد والإلغاء والقراءة والإثبات والفحوصات بلا أي مسار تعامل، D8). النوع محلي
 * لأن module wiring ما بيستوردش أنواعاً من موديول تاني.
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
  /** حالة سجل الدخول المقروءة تحت القفل — الإنشاء لسجل `PENDING` فقط (P1-2). */
  readonly recordState: 'PENDING' | 'CANCELLING';
  /** إعادة تثبيت ربط الهاتف عند استئناف سجل `STOPPED` (P1-4). */
  readonly resetBinding: boolean;
  /** مولّد UUID v7. */
  readonly ids: IdGenerator;
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
  readonly ids: IdGenerator;
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
  /** هل المستخدم حساب موظفة؟ (D8). */
  isStaffUser(userId: string): Promise<boolean>;
  /** هل الحساب (credential) يخص مستخدم موظفة؟ (P1-6). */
  isStaffAccount(accountId: string): Promise<boolean>;
  /** شركة حساب الموظفة أو null (P1-5). */
  staffCompanyOf(userId: string): Promise<string | null>;
  /** ربط المستخدم بمعرّف العملية (P1-5). */
  bindingOf(operationId: string): Promise<{ userId: string; companyId: string | null } | null>;
  /** مستخدم رابط token استهلاك كلمة السر (P1-6). */
  userIdForResetToken(token: string): Promise<string | null>;
}
