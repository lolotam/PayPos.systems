/**
 * يدمج صفوف تقرير 27b مع صفوف الموظفات المجدول بس؛ الموظفة في القائمتين بتفضل بصف التقرير.
 * الترتيب برقم الموظفة عشان الجدول يطلع زي جدول التقرير، والمدخلات ما بتتغيرش.
 *
 * @param reportRows صفوف تقرير 27b
 * @param scheduledRows صفوف الموظفات المجدول بس
 * @returns الصفوف المدمجة مرتبة برقم الموظفة
 */
export function mergeAttendanceStatementRows<T extends { employee_id: string; employee_number: number }>(
  reportRows: readonly T[],
  scheduledRows: readonly T[],
): T[] {
  const known = new Set(reportRows.map((row) => row.employee_id));
  const merged = [...reportRows, ...scheduledRows.filter((row) => !known.has(row.employee_id))];
  return merged.toSorted((a, b) => a.employee_number - b.employee_number);
}
