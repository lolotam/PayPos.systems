import type { planPackageSale } from '../domain/package-sale-plan.ts';
import type {
  CatalogReaderPort,
  CustomerLookupPort,
  DiscountLimitPort,
  PerformerCheckPort,
  SessionPlacePort,
  SessionRecordAccessPort,
} from './session-readers.port.ts';

/** خطة البيع المحسوبة في الدومين؛ التخزين والتدقيق والحدث بياخدوا منها كل اللي هيتكتب. */
export type PackageSalePlan = ReturnType<typeof planPackageSale>;

/** سياق مؤكد من النقل؛ الـ actor ما بييجيش من جسم الطلب. */
export interface PackageSaleContext {
  companyId: string;
  userId: string;
  businessId: string;
  branchId: string;
  key: string;
  fingerprint: string;
}

/** كل ما يحتاجه بائع الباقة معرّف هنا؛ الـ persistence وحدها تعرف Tx. */
export interface PackageSaleTransaction {
  place: SessionPlacePort;
  access: SessionRecordAccessPort;
  catalog: CatalogReaderPort;
  customer: CustomerLookupPort;
  performers: PerformerCheckPort;
  discount: DiscountLimitPort;
  /**
   * يحجز مفتاح إعادة الطلب قبل أي كتابة، فبيعيد الرد المحفوظ بدل ما يبيع مرتين.
   *
   * @param operation اسم الكتابة؛ واحد بس لأنه بيع الباقة عملية واحدة
   * @param work خطوات الكتابة اللي ما بتنفّذش لو الرد متسجل قبل كده
   * @returns الرد المحفوظ أو الجديد وعلامة replayed لإعادة التحقق من السلطة
   */
  idempotent<T>(operation: 'sell-package', work: () => Promise<T>): Promise<{ body: T; replayed: boolean }>;
  /**
   * يكتب الاستحقاق ومكوناته وجلساته في نفس المعاملة.
   *
   * @param plan خطة البيع المحسوبة بكل قيمها ومكوناتها وجلساتها
   * @returns يكتمل حفظ البيع كله قبل أي أثر تاني
   */
  insert(plan: PackageSalePlan): Promise<void>;
  /**
   * يسجل أثر البيع في سجل التدقيق بنفس المعاملة.
   *
   * @param plan خطة البيع المحسوبة لإثبات البائعة والمبلغ والخصم
   * @returns يكتمل حفظ سجل التدقيق مع البيع
   */
  audit(plan: PackageSalePlan): Promise<void>;
  /**
   * ينشر حدث تغيير البيع في outbox بنفس المعاملة.
   *
   * @param plan خطة البيع المحسوبة يحمل الحدث عامله ونسخته
   * @returns يكتمل إدخال الحدث مع البيع
   */
  emit(plan: PackageSalePlan): Promise<void>;
}

/** الحد الإلزامي للمعاملة يتيح اختبار التنسيق بدون قاعدة بيانات. */
export interface PackageSaleTransactions {
  /**
   * يدخل الشركة الموثقة ويضمن التراجع عن كل أثر عند أي فشل، حتى فشل commit.
   *
   * @param context الشركة والكاتب والنطاق ومفتاح الطلب وبصمته لعزل المعاملة وإعادة الطلب
   * @param work خطوات القراءة والكتابة باستعمال منافذ نفس المعاملة لضمان ذرية الآثار
   * @returns نتيجة الخطوات بعد نجاح commit فقط
   */
  run<T>(context: PackageSaleContext, work: (tx: PackageSaleTransaction) => Promise<T>): Promise<T>;
}
