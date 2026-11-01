import type { CommissionServiceOverride, CreateCommissionServiceOverrideInput } from '@pospay/contracts';

import type { CommissionInputLockScope } from './commission-input-lock-scope.port.ts';

/** هوية من يُنشئ التجاوز: المستأجر والنشاط والموظفة المستهدفة، لأن التجاوز يخص موظفة داخل نشاط ويقيَّد بصلاحية المستخدم. */
export interface CommissionServiceOverrideActor {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly employeeId: string;
}

/** طلب إنشاء تجاوز بهوية الفاعل والمفتاح والبصمة، لأن إعادة الإرسال يجب أن تُميَّز بين الطلب نفسه وطلب مختلف يحمل المفتاح نفسه. */
export interface CreateCommissionServiceOverrideCommand extends CommissionServiceOverrideActor {
  readonly input: CreateCommissionServiceOverrideInput;
  readonly key: string;
  readonly fingerprint: string;
}

/** خطوات الكتابة التي تحتاجها حالة استخدام تجاوز الخدمة داخل معاملة واحدة. */
export interface CommissionServiceOverrideScope extends CommissionInputLockScope {
  /**
   * بيتأكد إن الخدمة موجودة في النشاط بعد قفل الموظفة وقبل أقفال الشهور والكتابة.
   *
   * @returns true عند وجود الخدمة في النشاط
   */
  serviceExists(): Promise<boolean>;
  /**
   * بيدخل التجاوز ويرجع الصف كما خزّنته قاعدة البيانات بشكل العقد.
   *
   * @param record التجاوز كامل المعرف والتوقيت والقاعدة
   * @returns الصف المخزن
   */
  insert(record: CommissionServiceOverride): Promise<CommissionServiceOverride>;
  /**
   * بيكتب تدقيق إنشاء التجاوز بالقاعدة والتاريخ فقط، بلا راتب أو بيانات عميلة.
   *
   * @param record الصف المخزن الذي يوثقه الإدخال
   * @returns اكتمال التدقيق
   */
  audit(record: CommissionServiceOverride): Promise<void>;
}

/** حد المعاملة الذرية وإعادة الإرسال لإنشاء تجاوز خدمة. */
export interface CommissionServiceOverrideTransactions {
  /**
   * ينفذ التحقق والأقفال والكتابة والتدقيق مع مطالبة idempotent في معاملة شركة واحدة.
   *
   * @param command هوية الفاعل والطلب ومفتاح إعادة الإرسال
   * @param work خطوات حالة الاستخدام على المعاملة
   * @returns نتيجة العمل أو جسم الرد المخزن
   */
  run<T>(
    command: CreateCommissionServiceOverrideCommand,
    work: (scope: CommissionServiceOverrideScope) => Promise<T>,
  ): Promise<T>;
}
