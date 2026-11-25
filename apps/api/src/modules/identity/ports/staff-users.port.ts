import type { IdGenerator } from '@pospay/db';

/**
 * واجهة خطوة المستخدم على pospay_auth (ADR-0003 §4): الحساب يتعلم أو يتمسح بمعرّف العملية فقط،
 * ولا مسار تعامل (credential) بيتفتح له أبداً. التنفيذ الحقيقي هو `AuthService.staffUsers` من
 * packages/auth، وidentity هو المدخل الوحيد له — staff بيوصل له من خلال الدوال المصدَّرة في index.ts.
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
  /** حالة سجل الدخول المقروءة تحت القفل — الإنشاء لسجل `PENDING` فقط (P1-2). */
  readonly recordState: 'PENDING' | 'CANCELLING';
  /** إعادة تثبيت ربط الهاتف عند استئناف سجل `STOPPED` (P1-4). */
  readonly resetBinding: boolean;
  /** المانح المُؤكِّد للهاتف — بيتسجل في تدقيق المنصة (قرار D2). */
  readonly actorUserId: string;
  /** مولّد UUID v7 لصفوف المنصة. */
  readonly ids: IdGenerator;
  /**
   * معرّف المحاولة التي نفّذت الخطوة — بيتكرر في صف اعتماد الربط عشان تكرار المحاولة نفسها
   * مايعملش اعتماداً ثانياً ولا صف تدقيق ثاني (AC-ACT-2).
   */
  readonly attemptId?: string;
}

/** ناتج الخطوة الثانية: معرف المستخدم الموجود أو المُنشأ حديثاً. */
export interface StaffUserProvisioned {
  readonly userId: string;
}

/** مدخل تغيير هاتف حساب موظفة لها دخول فعّال (F3-1): الشركة ومعرّف العملية يثبتان ملكية الحساب. */
export interface StaffUserPhoneChangeInput {
  /** معرّف العملية من سجل الدخول — يطابق الماركر المكتوب على الحساب. */
  readonly operationId: string;
  /** شركة السجل؛ حساب شركة أخرى لا يُلمس. */
  readonly companyId: string;
  /** حساب الموظفة المطلوب تغيير هاتفه. */
  readonly userId: string;
  /** الهاتف الكانوني الجديد؛ رقم مملوك لأي مستخدم آخر يُرفض. */
  readonly phone: string;
  /** المانح المُؤكِّد للهاتف — بيتسجل في تدقيق المنصة. */
  readonly actorUserId: string;
  /** معرّف محاولة التغيير الحالية — تكرار المحاولة نفسها لا يكتب أثراً ثانياً. */
  readonly attemptId: string;
  /** مولّد UUID v7 لصفوف المنصة. */
  readonly ids: IdGenerator;
}

/** مدخل إلغاء سجل انتظار: حذف مستخدم الموظفة بمعرّف العملية المرتبط بنفس الشركة. */
export interface StaffUserCancelInput {
  readonly operationId: string;
  readonly companyId: string;
  /** المانح الملغي — بيتسجل في تدقيق المنصة. */
  readonly actorUserId: string;
  /** مولّد UUID v7 لصف التدقيق. */
  readonly ids: IdGenerator;
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
  provision(input: StaffUserProvisionInput): Promise<StaffUserProvisioned>;
  /**
   * يغيّر هاتف حساب موظفة لهذه الشركة وينهي كل جلساتها في معاملة auth واحدة (F3-1 الخطوة 2).
   *
   * @param input الحساب والعملية والشركة والهاتف الجديد ومعرّف المحاولة
   */
  changePhone(input: StaffUserPhoneChangeInput): Promise<void>;
  /**
   * يحذف مستخدم الموظفة بمعرّف العملية (إلغاء سجل انتظار متجاوز للمدة).
   *
   * @param input معرّف العملية وشركته واسم الملغي — حساب شركة أخرى لا يُلمس
   */
  cancel(input: StaffUserCancelInput): Promise<void>;
  /**
   * يقرأ مستخدم الموظفة بمعرّف العملية للعرض.
   *
   * @param operationId معرّف العملية
   * @returns المعرف وآخر ثلاثة أرقام من الهاتف، أو null لما مفيش حساب
   */
  read(operationId: string): Promise<StaffUserRead | null>;
  /**
   * ربط المستخدم بمعرّف العملية: المستخدم المطلوب فقط وشركته — إثبات المنح الوحيد (P1-5).
   *
   * @param operationId معرّف العملية
   */
  bindingOf(operationId: string): Promise<{ userId: string; companyId: string | null } | null>;
}
