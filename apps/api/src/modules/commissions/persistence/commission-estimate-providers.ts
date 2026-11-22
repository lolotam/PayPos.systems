import type { CommissionEstimateAttachment } from '@pospay/commissions-engine';
import type { Tx } from '@pospay/db';

import type {
  CommissionEstimateEmployeeName,
  CommissionEstimateScopeResult,
} from '../ports/commission-estimate.port.ts';

/**
 * مزودو تقدير العمولة من الوحدات صاحبة البيانات: النطاق الفعّال من identity،
 * والاسم والارتباطات من staff، وأسماء الخدمات من الكتالوج. الجذر بيربطهم
 * والموديول بياخدهم على معاملته.
 *
 * البورت نفسه مش بيعرف الداتابيز؛ المعاملة جوا هنا عشان كل القراءات تشارك
 * لقطة واحدة (D-25) من غير معاملة ثانية (ADR-0003 §4).
 */
export interface CommissionEstimateProviders {
  /**
   * بيحل النطاق الفعّال للقارئ على النشاط: الرفض الموحّد والميزة المقفولة سببان منفصلان.
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
   * بيرجّع موظفات النشاط بأسمائهن، لأن التقدير بيعرض الاسم (FR-023).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @param employeeId موظفة واحدة اختيارياً؛ من غيرها كل موظفات النشاط
   * @returns موظفات النشاط
   */
  employees(
    tx: Tx,
    companyId: string,
    businessId: string,
    employeeId: string | null,
  ): Promise<readonly CommissionEstimateEmployeeName[]>;
  /**
   * بيرجّع ارتباطات الموظفات بالفروع بتاريخها، وهي مفتاح الفلترة باليوم (CS-Q20).
   *
   * @param tx معاملة القراءة الحالية
   * @param companyId الشركة المؤكدة
   * @param businessId النشاط المطلوب
   * @param employeeIds الموظفات المطلوب ارتباطاتهن
   * @param period الشهر المطلوب بصيغة YYYY-MM
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
   * بيرجّع أسماء خدمات النشاط، لأن التقدير بيعرض العمل اللي earned العمولة (FR-023).
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
  ): Promise<ReadonlyMap<string, { readonly nameEn: string; readonly nameAr: string | null }>>;
}
