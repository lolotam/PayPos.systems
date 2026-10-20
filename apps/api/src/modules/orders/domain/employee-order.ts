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

/**
 * يجمع هويات الموظفات ويزيل التكرار بلا التفات لحالة الحروف ويرتبها تصاعدياً.
 * التوحيد قبل الترتيب يطابق قفل الصفوف وتقسيم العمولة، فالهوية نفسها لا تُقفل مرتين.
 *
 * @param lists قوائم الهويات من الناس والمجموعة الحالية والمجموعة المطلوبة
 * @returns الهويات الصغيرة الفريدة مرتبة
 */
export function ascendingEmployeeIds(...lists: readonly (readonly string[])[]): string[] {
  const ids = new Map<string, string>();
  for (const list of lists) {
    for (const id of list) ids.set(id.toLowerCase(), id.toLowerCase());
  }
  return [...ids.values()].sort(compareEmployeeId);
}

/** حد قارئ الموارد البشرية للدفعة الواحدة؛ أي دفعة أكبر يرفضها قبل القفل والقراءة. */
export const PERFORMER_BATCH = 80;

/**
 * يقسم هويات مرتبة إلى دفعات بالحجم المعطى من غير أن يغيّر ترتيبها.
 * الحجم حد القارئ؛ الدفعة الأخيرة قد تكون أقصر، والقائمة الفارغة لا تنتج دفعات.
 *
 * @param ids الهويات المرتبة مسبقاً
 * @param size حد الدفعة، أكبر من صفر
 * @returns الدفعات بنفس ترتيب المدخل
 */
export function employeeIdBatches(ids: readonly string[], size: number): string[][] {
  const batches: string[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    batches.push(ids.slice(index, index + size));
  }
  return batches;
}

/**
 * يقسم هويات المنفّذات الحالية والمحفوظة في سجل تغييرات السطر إلى دفعات قفل واحدة مرتبة تصاعدياً.
 * الترتيب التصاعدي العام يمنع تعارض الكتّاب على نفس صفوف الموظفات، ومنفذ الموارد البشرية يرفض دفعة أكبر من ثمانين هوية.
 *
 * @param current هويات المنفّذات الحالية على السطر
 * @param retained هويات المنفّذات المحفوظة في سجل تغييرات السطر
 * @returns دفعات الهويات الفريدة مرتبة تصاعدياً
 */
export function identityLockBatches(
  current: readonly { employee_id: string }[],
  retained: readonly { employee_id: string }[],
): string[][] {
  return employeeIdBatches(
    ascendingEmployeeIds(
      current.map((performer) => performer.employee_id),
      retained.map((performer) => performer.employee_id),
    ),
    PERFORMER_BATCH,
  );
}
