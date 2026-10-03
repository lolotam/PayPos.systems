import { parseMoney, moneyToString } from '@pospay/domain';

/** فشل تحقق الراتب بدون تسريب المبلغ في الخطأ أو السجلات. */
export class SalaryError extends Error {
  /**
   * سبب ثابت لا يحمل الراتب لأن الأخطاء قد تصل للسجلات.
   *
   * @param code رمز الرفض
   */
  constructor(
    readonly code:
      'VALIDATION_FAILED' | 'NOT_FOUND' | 'FEATURE_DISABLED' | 'TRANSACTION_RETRY_REQUIRED',
  ) {
    super(code);
  }
}
/** بيانات الراتب المالي داخل النطاق؛ المبلغ فلوس صحيحة فقط. */
export interface SalaryRecord {
  id: string;
  employee_id: string;
  effective_from: string;
  amount: bigint;
  set_by: string;
  revision: number;
  reason: string;
}
/**
 * يتحقق من الراتب الأساسي والتاريخ والسبب ويحوّل المبلغ لفلوس؛ الصفر مسموح لأي تاريخ حقيقي.
 *
 * @param input شروط المالك القادمة من العقد
 * @returns الشروط الصافية بمبلغ bigint وسبب مشذب
 */
export function validateSalary(input: SalaryTerms) {
  const reason = input.reason.trim();
  if (
    !/^(0|[1-9]\d{0,10})\.\d{3}$/.test(input.amount) ||
    reason.length < 1 ||
    reason.length > 500 ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(input.effective_from)
  )
    throw new SalaryError('VALIDATION_FAILED');
  const date = new Date(`${input.effective_from}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.effective_from)
    throw new SalaryError('VALIDATION_FAILED');
  return { ...input, amount: parseMoney(input.amount), reason };
}
/**
 * يبني استبدال تاريخ واحد؛ كل كتابة مقبولة ترفع النسخة حتى لو لم يتغير المبلغ.
 *
 * @param previous السجل الحالي المقفول أو غيابه
 * @param terms شروط متحققة بالفلوس
 * @param id معرف إنشاء محقون
 * @param employeeId الموظف المقفول
 * @param userId الفاعل المتحقق منه
 * @returns السجل التالي بلا تعديل السجل السابق
 */
export function nextSalary(
  previous: SalaryRecord | null,
  terms: ReturnType<typeof validateSalary>,
  id: string,
  employeeId: string,
  userId: string,
): SalaryRecord {
  if (previous !== null && previous.revision >= 2147483647)
    throw new SalaryError('VALIDATION_FAILED');
  return {
    ...terms,
    id: previous?.id ?? id,
    employee_id: employeeId,
    set_by: userId,
    revision: (previous?.revision ?? 0) + 1,
  };
}
/**
 * يحول فلوس الراتب لنص عشري للقاعدة والعقد والحدث دون float.
 *
 * @param record سجل النطاق
 * @returns نسخة قابلة لنقل JSON بثلاث خانات
 */
export function salarySnapshot(record: SalaryRecord) {
  return { ...record, amount: moneyToString(record.amount) };
}
/** شروط الراتب قبل التحويل إلى فلوس صحيحة. */
export interface SalaryTerms {
  effective_from: string;
  amount: string;
  reason: string;
}
