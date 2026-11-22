import type { Tx } from '@pospay/db';

/** الشركة والنشاط والمستخدم المثبتين من الجلسة والمسار، مش من استعلام العميل. */
export interface RatingsListScope {
  readonly companyId: string;
  readonly businessId: string;
  readonly userId: string;
}

/** اسما الموظفة كما يجيوا من staff: العربي اختياري والإنجليزي لازم. */
export interface RatingEmployeeName {
  readonly name_ar: string | null;
  readonly name_en: string;
}

/** اسم الفرع كما يجي من tenancy: العربي اختياري والإنجليزي لازم. */
export interface RatingBranchName {
  readonly name_ar: string | null;
  readonly name_en: string;
}

export const RATINGS_LIST_READS = Symbol('RATINGS_LIST_READS');

/**
 * قراءات قائمة التقييمات ومتوسطاتها في الأدمن اللي مش تبع customers: الصلاحية الحالية من identity وأسماء الفروع وتوقيت
 * النشاط من tenancy وأسماء الموظفات من staff، وكلها على نفس معاملة القراءة عشان الصلاحية والنتيجة يطلعوا من لقطة واحدة (FR-B15).
 */
export interface RatingsListReads {
  /**
   * بيرجّع الفروع اللي المستخدم يقرأ تقييماتها دلوقتي.
   *
   * @param tx    معاملة القراءة على الشركة
   * @param scope الشركة والنشاط والمستخدم
   * @param now   عينة الساعة المشتركة
   * @returns الفروع المسموحة، وفاضية لما مفيش وصول فالمسار يرد 403
   */
  access(tx: Tx, scope: RatingsListScope, now: Date): Promise<readonly string[]>;
  /**
   * بيرجّع أسماء فروع النشاط لعرض الفرع في الصف من غير ما customers تقرأ جداول tenancy.
   *
   * @param tx         معاملة القراءة على الشركة
   * @param businessId النشاط
   * @returns اسم كل فرع بمعرّفه
   */
  branchNames(tx: Tx, businessId: string): Promise<ReadonlyMap<string, RatingBranchName>>;
  /**
   * بيرجّع توقيت النشاط عشان الشهر الحالي في المتوسطات يتحدد بيه، من غير ما customers تقرأ جدول النشاط.
   *
   * @param tx    معاملة القراءة على الشركة
   * @param scope الشركة والنشاط والمستخدم
   * @returns اسم المنطقة الزمنية، أو null لو النشاط مش موجود
   */
  timeZone(tx: Tx, scope: RatingsListScope): Promise<string | null>;
  /**
   * بيرجّع أسماء الموظفات المعروضات في الصفحة بمعرّفاتها في قراءة واحدة، من غير ما customers تقرأ جداول staff.
   *
   * @param tx          معاملة القراءة على الشركة
   * @param companyId   الشركة المؤكدة من الجلسة
   * @param employeeIds معرّفات الموظفات المعروضات
   * @returns الاسمان لكل موظفة موجودة بمعرّفها
   */
  employeeNames(
    tx: Tx,
    companyId: string,
    employeeIds: readonly string[],
  ): Promise<ReadonlyMap<string, RatingEmployeeName>>;
}
