/** فترة ارتباط البائعة بفرع؛ البداية داخلة والنهاية خارجة، وnull يعني ارتباطًا مفتوحًا. */
export type PackageSellerAttachment = {
  readonly branch_id: string;
  readonly from: string;
  readonly to: string | null;
};

/**
 * يحدد أهلية بيع الباقة في يوم الفرع المحلي من العقد والحذف والارتباط.
 * الموظفة المحذوفة غير مؤهلة؛ يوم التعيين ونهاية العقد داخلان، ونهاية ارتباط الفرع خارجة.
 *
 * @param employee حقائق عقد البائعة وفترات ارتباطها بالفروع
 * @param employee.hire_date تاريخ بدء عمل البائعة، وهو داخل في الأهلية
 * @param employee.contract_end نهاية العقد، وهي داخلة في الأهلية أو null للعقد المفتوح
 * @param employee.deleted_at تاريخ الحذف الذي يمنع الأهلية عند وجوده
 * @param employee.attachments فترات ارتباط البائعة بالفروع بتواريخها المحلية
 * @param branchId فرع البيع المطلوب إثبات ارتباطها به
 * @param date يوم البيع المحلي بصيغة YYYY-MM-DD
 * @returns true عندما تكون البائعة نشطة ومرتبطة بالفرع في ذلك اليوم
 */
export function packageSellerEligible(
  employee: {
    hire_date: string;
    contract_end: string | null;
    deleted_at: string | null;
    attachments: readonly PackageSellerAttachment[];
  },
  branchId: string,
  date: string,
): boolean {
  return (
    employee.deleted_at === null &&
    employee.hire_date <= date &&
    (employee.contract_end === null || employee.contract_end >= date) &&
    employee.attachments.some(
      (link) =>
        link.branch_id === branchId &&
        link.from <= date &&
        (link.to === null || date < link.to),
    )
  );
}
