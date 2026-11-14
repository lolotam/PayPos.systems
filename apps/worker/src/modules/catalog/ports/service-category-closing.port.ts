import type { ServiceCategoryClosingFailure } from '../domain/service-category-closing-job.ts';

/** نتيجة تشغيل الوظيفة: اكتمل، أو فشل برمز معروف، أو لا عمل. */
export type ServiceCategoryClosingOutcome =
  | { readonly kind: 'completed'; readonly servicesChanged: number }
  | { readonly kind: 'failed'; readonly code: ServiceCategoryClosingFailure }
  | { readonly kind: 'noop' };

/** معاملات الوظيفة: القفل والصف والوقت، كل واحد في معاملته. */
export interface ServiceCategoryClosingTransactions {
  /**
   * يشغّل الطلب في معاملة واحدة: يقفل التصنيف وصف الطلب، ويطبق القفل أو الفتح على خدمات
   * التصنيف، ويكتب النتيجة على صف الطلب.
   *
   * @param companyId الشركة المالكة لصف الطلب
   * @param closingId صف طلب القفل أو الفتح
   * @param at        اللحظة المحقونة التي تُقاس بها الموعد وتُكتب بها الأوقات
   * @returns اكتمال التشغيل مع عدد الخدمات المتغيرة، أو رمز الفشل، أو لا عمل
   */
  run(companyId: string, closingId: string, at: Date): Promise<ServiceCategoryClosingOutcome>;
  /**
   * يكتب رمز الفشل على صف معلق فقط، حتى لا يمحو نتيجة اكتملت قبله.
   *
   * @param companyId الشركة المالكة لصف الطلب
   * @param closingId صف طلب القفل أو الفتح
   * @param code      رمز الفشل الآمن الذي يظهر للمستخدم
   * @param at        اللحظة المحقونة التي يُكتب بها وقت الانتهاء
   * @returns اكتمال التحديث الشرطي
   */
  fail(
    companyId: string,
    closingId: string,
    code: ServiceCategoryClosingFailure,
    at: Date,
  ): Promise<void>;
  /**
   * يقرأ طالب الطلب ليحمل سجل الفشل معرّف المستخدم؛ الطلب ما بيأثرش في القرار.
   *
   * @param companyId الشركة المالكة لصف الطلب
   * @param closingId صف طلب القفل أو الفتح
   * @returns معرّف المستخدم الطالب أو غياب الصف
   */
  readRequester(companyId: string, closingId: string): Promise<string | null>;
}

/** سياق التشخيص: معرّفات الارتباط ورمز ثابت فقط، بلا رسالة السائق ولا نص الاستعلام. */
export interface ServiceCategoryClosingFailureContext {
  companyId: string;
  closingId: string;
  requestedBy: string | null;
  code: ServiceCategoryClosingFailure;
}

/** تشخيص آمن لقرار الفشل؛ لا يحمل إلا رمزًا ثابتًا ومعرّفات الارتباط. */
export interface ServiceCategoryClosingDiagnostics {
  /**
   * يسجل رمز القرار الآمن فقط دون رسالة السائق أو نص الاستعلام.
   *
   * @param context الشركة والطلب والمستخدم الطالب ورمز ثابت يصف سبب الفشل
   * @returns تسجيل التشخيص المختصر
   */
  failed(context: ServiceCategoryClosingFailureContext): void;
}
