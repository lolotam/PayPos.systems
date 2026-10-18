/** سطر نشط بمعرّفه فقط؛ الدالة لا تقرأ حالة لأن المستدعي صفّى النشط مسبقاً. */
export interface CancelTipLine {
  id: string;
}

/**
 * يسمّي موظفات سيتبقّى لهن بقشيش بلا سطر نشط لو أُلغي هذا السطر.
 * المجموعة الحالية الفارغة لا تمنع، ومن لها سطر نشط آخر لا تُذكر، والمبالغ لا تخرج لأن الرفض يكشف هوية لا مالاً.
 *
 * @param lineId السطر المطلوب إلغاؤه
 * @param activeLines الأسطر النشطة في الزيارة، ومنها هذا السطر إن كان نشطاً
 * @param performersByLine منفّذات كل سطر بمعرّفات الموظفات
 * @param currentTipEmployeeIds موظفات المجموعة الحالية للبقشيش بأي طريقة دفع
 * @returns معرّفات الموظفات المانعات، بلا تكرار، مرتبة ترتيباً معجمياً
 */
export function cancelBlockedByTip(
  lineId: string,
  activeLines: readonly CancelTipLine[],
  performersByLine: ReadonlyMap<string, readonly string[]>,
  currentTipEmployeeIds: readonly string[],
): string[] {
  if (currentTipEmployeeIds.length === 0) return [];
  const tipped = new Set(currentTipEmployeeIds);
  const blocked = new Set<string>();
  for (const employeeId of performersByLine.get(lineId) ?? []) {
    if (!tipped.has(employeeId)) continue;
    if (hasOtherActiveLine(lineId, employeeId, activeLines, performersByLine)) continue;
    blocked.add(employeeId);
  }
  return [...blocked].sort();
}

function hasOtherActiveLine(
  lineId: string,
  employeeId: string,
  activeLines: readonly CancelTipLine[],
  performersByLine: ReadonlyMap<string, readonly string[]>,
): boolean {
  for (const line of activeLines) {
    if (line.id === lineId) continue;
    if ((performersByLine.get(line.id) ?? []).includes(employeeId)) return true;
  }
  return false;
}
