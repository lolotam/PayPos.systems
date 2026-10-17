/**
 * يرتّب هويات الموظفات تصاعدياً بعد توحيد حالة الأحرف.
 * المعرّف نفسه بحروف مختلفة هو موظفة واحدة، والترتيب يطابق تقسيم العمولة.
 *
 * @param left هوية الموظفة الأولى
 * @param right هوية الموظفة الثانية
 * @returns سالب لو الأولى أصغر، وصفر عند التساوي، وموجب لو الثانية أصغر
 */
export function compareEmployeeId(left: string, right: string): number {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  return lowerLeft < lowerRight ? -1 : lowerLeft > lowerRight ? 1 : 0;
}
