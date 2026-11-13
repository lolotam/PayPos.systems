import type { SalePackageType } from '@pospay/domain';
import type { planPackageSale } from '../domain/package-sale-plan.ts';
import type { PackageSellerFacts } from '../domain/package-sale-rules.ts';

export type PackageSalePlan = ReturnType<typeof planPackageSale>;

/** طلب البيع المقبول بهويته وسياقه وحدّ الخصم المجمدين من القبول. */
export interface PackageSaleRequest {
  readonly id: string;
  readonly business_id: string;
  readonly branch_id: string;
  readonly recorded_by: string;
  readonly recorded_by_membership_id: string;
  readonly discount_limit_bps: number | null;
  readonly customer_id: string;
  readonly package_type_id: string;
  readonly expected_type_revision: number;
  readonly expected_service_revisions: readonly {
    service_id: string;
    revision: number;
  }[];
  readonly price_paid: string;
  readonly paid_method: 'CASH' | 'CARD';
  readonly seller_employee_id: string;
  readonly sold_at: string | null;
  readonly recorded_at: string;
}

/** نطاق بيع واحد يجمع الأقفال والقراءات والكتابات في معاملة المستأجر نفسها. */
export interface PackageSaleScope {
  readonly request: PackageSaleRequest;
  /** يقفل النوع ثم خدماته ويعيد لقطة البيع، أو null عندما لا يتبع النوع هذا النشاط.
   *
   * @returns النوع وخدماته المقفولة بالأسعار والنسخ الحالية، أو null للرفض المسمى
   */
  lockType(): Promise<SalePackageType | null>;
  /** يقفل الموظفة البائعة قبل قراءة أهليتها لمنع سباق فك الارتباط أو تغيير الحساب.
   *
   * @param employeeId هوية البائعة المجمدة في الطلب
   * @returns يكتمل بعد أخذ قفل المشاركة على صف الموظفة
   */
  lockSeller(employeeId: string): Promise<void>;
  /** يعيد توقيت فرع البيع الفعلي لتحديد يوم البيع والانتهاء، أو null عند تعذر المكان.
   *
   * @returns توقيت الفرع النشط مع fallback للنشاط، أو null
   */
  readPlace(): Promise<{ timezone: string } | null>;
  /** يثبت وجود العميلة داخل الشركة قبل إنشاء الاستحقاق.
   *
   * @param customerId هوية العميلة المجمدة في الطلب
   * @returns true عندما تكون العميلة موجودة في نطاق المستأجر
   */
  customerExists(customerId: string): Promise<boolean>;
  /** يعيد أهلية البائعة ورابط حسابها في يوم البيع بعد قفلها.
   *
   * @param employeeId هوية البائعة المقفولة
   * @param businessDate يوم البيع المحلي في توقيت الفرع
   * @returns حقائق البائعة، أو undefined عندما لا تكون موجودة في النشاط
   */
  readSeller(
    employeeId: string,
    businessDate: string,
  ): Promise<PackageSellerFacts | undefined>;
  /** يدرج الاستحقاق ومكوناته وجلساته دون كتابة أي أثر آخر.
   *
   * @param plan خطة البيع الكاملة بالقيم المالية والهويات الثابتة
   * @returns يكتمل بعد إدخال الجداول المالية الثلاثة
   */
  insert(plan: PackageSalePlan): Promise<void>;
  /** يكتب تدقيق package.sold باسم المسجّلة المجمدة في الطلب.
   *
   * @param plan خطة البيع التي يؤخذ منها الأثر المالي الآمن
   * @returns يكتمل بعد إدخال أثر التدقيق
   */
  audit(plan: PackageSalePlan): Promise<void>;
  /** يلحق PackageSaleChanged في outbox داخل معاملة البيع نفسها.
   *
   * @param plan خطة البيع الحاملة للاستحقاق والحدث
   * @returns يكتمل بعد إدخال حدث البيع
   */
  emit(plan: PackageSalePlan): Promise<void>;
  /** ينهي الطلب المعلق ويربطه بالاستحقاق، ويرفض لو لم يتغير صف واحد لإعادة المحاولة.
   *
   * @param entitlementId هوية الاستحقاق المدخل في المعاملة نفسها
   * @param at لحظة الانتهاء من الساعة المحقونة
   * @returns يكتمل بعد تحديث صف الطلب المعلق وحده
   */
  complete(entitlementId: string, at: string): Promise<void>;
}

/** معاملات تنفيذ البيع وتثبيت الرفض الدائم بعد rollback. */
export interface PackageSaleTransactions {
  /** يقفل الطلب المعلق وينفذ البيع كله في معاملة واحدة، ولا يستدعي work لطلب منتهٍ.
   *
   * @param companyId هوية المستأجر
   * @param requestId هوية طلب البيع
   * @param work تسلسل أقفال وقواعد وكتابات البيع
   * @returns يكتمل بعد COMMIT، أو فورًا عندما لا يوجد طلب pending
   */
  run(
    companyId: string,
    requestId: string,
    work: (scope: PackageSaleScope) => Promise<void>,
  ): Promise<void>;
  /** يثبت رفضًا مسمى في معاملة قصيرة ثانية دون كتابة أي أثر مالي آخر.
   *
   * @param companyId هوية المستأجر
   * @param requestId هوية طلب البيع
   * @param code رمز الرفض المسمى الآمن
   * @param details تفاصيل الرفض الآمنة، وundefined يخزن SQL NULL
   * @param at لحظة تثبيت الفشل من الساعة المحقونة
   * @returns يكتمل بعد تحديث الطلب الذي ما زال pending فقط
   */
  fail(
    companyId: string,
    requestId: string,
    code: string,
    details: unknown,
    at: string,
  ): Promise<void>;
}

/** ساعة محقونة لتوحيد لحظتي الإكمال والفشل دون قراءة ساعة التنفيذ للحساب التجاري. */
export interface PackageSaleClock {
  /** يعيد لحظة التنفيذ المستخدمة فقط في finished_at.
   *
   * @returns وقت التنفيذ الحالي من الساعة المحقونة
   */
  now(): Date;
}

/** مولد هويات محقون ليثبت الاستحقاق والمكونات والجلسات والآثار كبيانات للدومين. */
export interface PackageSaleIds {
  /** يعيد هوية جديدة لعنصر واحد من عناصر خطة البيع أو آثارها.
   *
   * @returns UUID v7 جديد
   */
  newId(): string;
}
