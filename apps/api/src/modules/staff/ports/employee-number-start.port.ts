/** الشركة والمستخدم من الجلسة؛ المعاملة تضبط المستأجر منهما. */
export interface EmployeeNumberStartActor {
  companyId: string;
  userId: string;
}

/** صف العدّاد بعد قفله: البداية null تعني أن الضبط لسه مسموح. */
export interface EmployeeNumberSequenceRow {
  nextNumber: number;
  startNumber: number | null;
}

/** قبل وبعد البداية والعدّاد كما يُكتبان في التدقيق، بلا الطوابع الزمنية. */
export interface EmployeeNumberStartAudit {
  before: { start_number: null; next_number: number };
  after: { start_number: number; next_number: number };
}

/** الساعة المحقونة حتى يبقى start_set_at و updated_at على لحظة واحدة. */
export interface EmployeeNumberStartClock {
  /** لحظة ضبط البداية. */
  now(): Date;
}

/**
 * خطوات ضبط البداية داخل معاملة واحدة: الشركة والعضويات، ثم إعادة الفحص، ثم صف العدّاد، ثم التدقيق.
 */
export interface EmployeeNumberStartScope {
  /** يقفل الشركة ثم العضويات قبل صف العدّاد حتى يبقى ترتيب TD-4. */
  lockAccess(): Promise<void>;
  /** يعيد فحص الصلاحية على الشركة وميزة الموظفين؛ الجهاز لا يمر حتى لا يُنشأ صف العدّاد لمن لا يملك. */
  recheck(): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  /** ينشئ صف العدّاد إن غاب ثم يقفل next_number و start_number قبل الكتابة. */
  lockCounter(): Promise<EmployeeNumberSequenceRow>;
  /**
   * يخزن البداية والعدّاد ويسجل التدقيق في نفس المعاملة حتى يتراجعا معاً.
   *
   * @param at لحظة الساعة المحقونة
   * @param change قبل وبعد البداية والعدّاد
   */
  save(at: Date, change: EmployeeNumberStartAudit): Promise<void>;
}

/** يفتح معاملة الشركة الواحدة التي تجمع القفل والكتابة والتدقيق. */
export interface EmployeeNumberStartTransactions {
  /**
   * يضمن التراجع عن الصف والتدقيق معاً عند أي رفض.
   *
   * @param actor الشركة والمستخدم من الجلسة
   * @param work العمل داخل المعاملة
   */
  run<T>(
    actor: EmployeeNumberStartActor,
    work: (scope: EmployeeNumberStartScope) => Promise<T>,
  ): Promise<T>;
}
