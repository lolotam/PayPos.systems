import type { CommissionEstimateAttachment } from '@pospay/commissions-engine';
import type { Tx } from '@pospay/db';

import type {
  CommissionEstimateEmployeeName,
  CommissionEstimateScopeResult,
} from './commission-estimate.port.ts';

/** موظفة النشاط ببطاقتها، وهل مدة عملها بتغطي الشهر (قاعدة «في النطاق» FR-033). */
export interface CommissionStatementEmployeeName extends CommissionEstimateEmployeeName {
  readonly employedDuringPeriod: boolean;
  /** آخر يوم في العقد YYYY-MM-DD أو null؛ غايب في التجهيزات البسيطة فبيتعامل معاه كـ null (CM-50). */
  readonly contractEnd?: string | null;
  /** يوم الحذف بتوقيت النشاط YYYY-MM-DD أو null؛ غايب في التجهيزات البسيطة فبيتعامل معاه كـ null (CM-50). */
  readonly deletedOn?: string | null;
}

/**
 * مزودو كشف العمولة من الوحدات صاحبة البيانات، مربوطين في جذر التطبيق (spec 059 D-16): النطاق الفعّال
 * من identity، والموظفات وارتباطاتهن من staff، وأسماء الفروع من tenancy، والأسماء الكاملة للعملاء من
 * customers، وأسماء الخدمات من الكتالوج. كل قراءة على معاملة الكشف نفسها فكلها من لقطة واحدة؛ والمزوّد
 * بيرجّع اللي لقاه بس، وقارئ الكشف هو اللي بيكمّل الناقص ببديل الاسم (D-21).
 */
export interface CommissionStatementProviders {
  /**
   * بيحل النطاق الفعّال للقارئ على النشاط.
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param userId المستخدم البشري الفاعل
   * @param businessId النشاط المطلوب
   * @returns النطاق أو سبب الرفض
   */
  scope(
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ): Promise<CommissionEstimateScopeResult>;
  /**
   * بيقول هل ميزة العمولات مفعّلة للشركة.
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @returns هل الميزة مفعّلة
   */
  featureEnabled(tx: Tx, companyId: string): Promise<boolean>;
  /**
   * بيرجّع موظفات النشاط ببطاقاتهن وهل شغلهن بيغطي الشهر، المحذوفات معاهم.
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @param period الشهر بصيغة YYYY-MM
   * @returns الموظفات
   */
  employees(
    tx: Tx,
    companyId: string,
    businessId: string,
    period: string,
  ): Promise<readonly CommissionStatementEmployeeName[]>;
  /**
   * بيرجّع ارتباطات الموظفات بالفروع بتاريخها، وهي مفتاح فروع كل صف (FR-033).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @param employeeIds الموظفات المطلوب ارتباطاتهن
   * @param period الشهر بصيغة YYYY-MM
   * @returns الارتباطات التي تغطي الشهر
   */
  attachments(
    tx: Tx,
    companyId: string,
    businessId: string,
    employeeIds: readonly string[],
    period: string,
  ): Promise<readonly CommissionEstimateAttachment[]>;
  /**
   * بيرجّع أسماء الفروع اللي اتعمل فيها الشغل، حيّة، المحذوف معاها (CS-Q35، D-20).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @param branchIds معرّفات الفروع المطلوبة
   * @returns اسم كل فرع موجود
   */
  branchNames(
    tx: Tx,
    companyId: string,
    businessId: string,
    branchIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly nameAr: string | null; readonly nameEn: string }>>;
  /**
   * بيرجّع أسماء الخدمات الحيّة، المقفولة معاها (D-20، FR-023).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @param serviceIds معرّفات الخدمات المطلوبة
   * @returns اسم كل خدمة موجودة
   */
  serviceNames(
    tx: Tx,
    companyId: string,
    businessId: string,
    serviceIds: readonly string[],
  ): Promise<ReadonlyMap<string, { readonly nameAr: string | null; readonly nameEn: string }>>;
  /**
   * بيرجّع الاسم الكامل للعميل، من غير أي تليفون أبداً (FR-028، CS-Q15).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param customerIds معرّفات العملاء المطلوبة
   * @returns الاسم الكامل لكل عميل موجود
   */
  customerNames(
    tx: Tx,
    companyId: string,
    customerIds: readonly string[],
  ): Promise<ReadonlyMap<string, string>>;
}
