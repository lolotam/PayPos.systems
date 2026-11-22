import { updateRequestContext } from '@pospay/observability';

/**
 * يربط الشركة المؤكدة في سياق السجل عشان سطور القراءة تنسب للشركة الصح.
 * القيمة لازم تكون متأكَّدة الأول: هيدر الطلب مش دليل، والعضوية اللي اتأكدت
 * جوه معاملة القراءة هي اللي بتخلي المعرف مقبول هنا.
 *
 * @param companyId معرّف الشركة المؤكدة
 */
export function bindVerifiedCompany(companyId: string): void {
  updateRequestContext({ companyId });
}
