import type { StatementMonthRows } from './statement-types.ts';

/** صفوف الشهر مجمّعة بالموظفة مرة واحدة؛ كل قائمة مفتاحها معرّف الموظفة. */
export type GroupedMonth = {
  readonly [K in keyof Omit<StatementMonthRows, 'blocked'>]: Map<
    string,
    StatementMonthRows[K][number][]
  >;
};

/**
 * يجمّع عناصر بمعرّف موظفة؛ العنصر بلا موظفة (بيع من غير بائعة) بيتساب.
 *
 * @param items العناصر
 * @param employeeOf معرّف الموظفة أو null
 * @returns العناصر مجمّعة بالموظفة بترتيبها الأصلي
 */
export function groupByEmployee<T>(
  items: readonly T[],
  employeeOf: (item: T) => string | null,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const employeeId = employeeOf(item);
    if (employeeId === null) continue;
    const bucket = grouped.get(employeeId);
    if (bucket === undefined) grouped.set(employeeId, [item]);
    else bucket.push(item);
  }
  return grouped;
}

/**
 * يجمّع كل قوائم الشهر اللي بيحتاجها المجمّع المشترك بالموظفة مرة واحدة، فكل موظفة بتاخد
 * صفوفها هي بس بدل ما كل واحدة تمسح الشهر كله.
 *
 * @param month صفوف الشهر
 * @returns القوائم مجمّعة بالموظفة
 */
export function groupMonth(month: StatementMonthRows): GroupedMonth {
  return {
    lines: groupByEmployee(month.lines, (line) => line.employeeId),
    sales: groupByEmployee(month.sales, (sale) => sale.sellerEmployeeId),
    tips: groupByEmployee(month.tips, (tip) => tip.employeeId),
    salaries: groupByEmployee(month.salaries, (salary) => salary.employeeId),
    versions: groupByEmployee(month.versions, (version) => version.employeeId),
    overrides: groupByEmployee(month.overrides, (override) => override.employeeId),
    corrections: groupByEmployee(month.corrections, (correction) => correction.employeeId),
    carries: groupByEmployee(month.carries, (carry) => carry.employeeId),
  };
}

/**
 * صفوف موظفة واحدة من التجميع، بنفس ترتيب القوائم الأصلية.
 *
 * @param grouped الشهر مجمّعًا بالموظفة
 * @param employeeId الموظفة
 * @returns صفوفها هي بس من كل قائمة
 */
export function monthOfEmployee(
  grouped: GroupedMonth,
  employeeId: string,
): Omit<StatementMonthRows, 'blocked'> {
  return {
    lines: grouped.lines.get(employeeId) ?? [],
    sales: grouped.sales.get(employeeId) ?? [],
    tips: grouped.tips.get(employeeId) ?? [],
    salaries: grouped.salaries.get(employeeId) ?? [],
    versions: grouped.versions.get(employeeId) ?? [],
    overrides: grouped.overrides.get(employeeId) ?? [],
    corrections: grouped.corrections.get(employeeId) ?? [],
    carries: grouped.carries.get(employeeId) ?? [],
  };
}

/**
 * ارتباطات الموظفات مجمّعة بالموظفة.
 *
 * @param attachments الارتباطات الحيّة
 * @returns الارتباطات مجمّعة بالموظفة
 */
export function groupAttachments<T extends { readonly employeeId: string }>(
  attachments: readonly T[],
): Map<string, T[]> {
  return groupByEmployee(attachments, (attachment) => attachment.employeeId);
}
