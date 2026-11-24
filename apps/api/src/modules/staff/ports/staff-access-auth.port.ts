import type { StaffAccessIds } from './staff-access-begin.port.ts';

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
  readonly ids: StaffAccessIds;
  /**
   * معرّف المحاولة التي نفّذت الخطوة — بيتكرر في صف اعتماد الربط عشان تكرار المحاولة نفسها
   * مايعملش اعتماداً ثانياً ولا صف تدقيق ثاني (AC-ACT-2).
   */
  readonly attemptId?: string;
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
  readonly ids: StaffAccessIds;
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
  /** يثبت المستخدم والشركة للعملية قبل كتابة العضوية.
   *
   * @param operationId العملية المقفولة
   */
  bindingOf(operationId: string): Promise<{ userId: string; companyId: string | null } | null>;
}
