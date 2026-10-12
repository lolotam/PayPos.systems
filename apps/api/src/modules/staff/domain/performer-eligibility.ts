import { linkedOn, type DefaultShiftLink } from './employee-default-shifts.ts';

/** حقائق الموارد البشرية اللازمة للأداء، بتواريخ محلية كي لا تتغير الحدود مع تحويل UTC. */
export type PerformerEligibilityFacts = {
  readonly hire_date: string;
  readonly contract_end: string | null;
  readonly deleted_at: string | null;
  readonly attachments: readonly DefaultShiftLink[];
};

/**
 * يحدد أهلية تنفيذ الخدمة في يوم الفرع المحلي من حقائق العقد والارتباط.
 * الموظفة المحذوفة غير مؤهلة؛ يوم التعيين ونهاية العقد داخلان، ونهاية ارتباط الفرع خارجة.
 *
 * @param employee حقائق الموظفة وفترات ارتباطها بالفرع
 * @param branchId فرع تنفيذ الخدمة
 * @param date تاريخ تنفيذ الخدمة المحلي بصيغة YYYY-MM-DD
 * @returns أهلية الموظفة للأداء في الفرع واليوم المحددين
 */
export function performerEligible(
  employee: PerformerEligibilityFacts,
  branchId: string,
  date: string,
): boolean {
  return employee.deleted_at === null &&
    employee.hire_date <= date &&
    (employee.contract_end === null || employee.contract_end >= date) &&
    linkedOn(employee.attachments, branchId, date);
}
