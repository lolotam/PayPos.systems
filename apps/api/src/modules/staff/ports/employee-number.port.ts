import type { EmployeeNumberAudit } from '../domain/employee-number-change.ts';

/** صف الموظفة كما يُقرأ قبل القفل؛ الفروع الحالية هي أهداف إعادة فحص المنع. */
export interface EmployeeNumberRow {
  business_id: string;
  primary_branch_id: string;
  employee_number: number | null;
  attached_branch_ids: readonly string[];
}

/** الصف بعد قفل الموظفة. الفروع تُعاد قراءتها لأن القراءة الأولى كانت بلا قفل. */
export interface EmployeeNumberLock {
  primary_branch_id: string;
  employee_number: number | null;
  attached_branch_ids: readonly string[];
}

/** الشركة والمستخدم من الجلسة؛ المعاملة تضبط المستأجر منهما. */
export interface SetEmployeeNumberActor {
  companyId: string;
  userId: string;
}

/**
 * خطوات تعديل الرقم داخل معاملة واحدة بترتيب أقفال ثابت: الصلاحية، ثم العدّاد عند التغيير فقط، ثم صف الموظفة.
 */
export interface SetEmployeeNumberScope {
  /** يقفل الشركة النشطة ثم العضويات قبل قراءة الموظفة؛ false شركة محذوفة فتُرفض قبل القراءة. */
  lockAccess(): Promise<boolean>;
  /**
   * يقرأ الموظفة بلا قفل لمعرفة نشاطها وفرعها ورقمها قبل قرار القفل الأثقل.
   *
   * @param businessId النشاط في المسار
   * @param employeeId الموظفة
   */
  readEmployee(businessId: string, employeeId: string): Promise<EmployeeNumberRow | null>;
  /**
   * يرجع FORBIDDEN أو FEATURE_DISABLED أو null حتى يوقف التعديل قبل الكتابة إن مُنع النشاط أو فرع أو أُغلقت ميزة الموظفين.
   *
   * @param businessId نشاط الصف
   * @param branchIds الفرع الرئيسي ثم الارتباطات الحالية
   */
  recheck(
    businessId: string,
    branchIds: readonly string[],
  ): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /** يقفل عدّاد الشركة دون تحريكه حتى لا يتسابق الإسناد التلقائي مع التعديل اليدوي. */
  lockCounter(): Promise<void>;
  /**
   * يقفل صف الموظفة ويعيد رقمها وفرعها الرئيسي وارتباطاتها الحالية؛ القراءة الأولى كانت بلا قفل فقد تتغير الفروع قبله.
   *
   * @param businessId النشاط
   * @param employeeId الموظفة
   */
  lockEmployee(businessId: string, employeeId: string): Promise<EmployeeNumberLock | null>;
  /**
   * يتحقق أن الرقم محجوز لموظفة أخرى حتى لو كانت محذوفة ناعماً.
   *
   * @param employeeId الموظفة المستثناة
   * @param employeeNumber الرقم المطلوب
   */
  taken(employeeId: string, employeeNumber: number): Promise<boolean>;
  /**
   * يكتب الرقم ويسجل قبل وبعد من نفس التغيير حتى لا يختلف التدقيق عن الصف.
   *
   * @param employeeId الموظفة
   * @param change قبل وبعد الرقم
   */
  save(employeeId: string, change: EmployeeNumberAudit): Promise<void>;
}

/** يفتح معاملة الشركة الواحدة التي تجمع القفل والكتابة والتدقيق. */
export interface SetEmployeeNumberTransactions {
  /**
   * يضمن التراجع عن الرقم والتدقيق معاً عند أي رفض.
   *
   * @param actor الشركة والمستخدم من الجلسة
   * @param work العمل داخل المعاملة
   */
  run<T>(
    actor: SetEmployeeNumberActor,
    work: (scope: SetEmployeeNumberScope) => Promise<T>,
  ): Promise<T>;
}
