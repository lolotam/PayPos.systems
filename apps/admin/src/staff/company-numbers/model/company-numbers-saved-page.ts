import type { EmployeeNumberPage } from '@pospay/contracts';

type Item = EmployeeNumberPage['items'][number];

// الأرقام بس بتطابق الرقم بالظبط أو اسم فيه نفس الأرقام (EN-Q16)؛ أي نص تاني بيطابق الاسم، والاسم ما اتغيّرش.
function stillMatches(item: Item, q: string, employeeNumber: number): boolean {
  if (!/^[0-9]+$/.test(q)) return true;
  if (Number(q) === employeeNumber) return true;
  return [item.name_ar, item.name_en].some((name) => name?.includes(q) ?? false);
}

/** صفحة القائمة بعد حفظ رقم: الصف بيتحدّث، وبيخرج من صفحة بحث بالأرقام لو مابقاش مطابق. */
export function withSavedNumber(
  page: EmployeeNumberPage,
  q: string | null,
  employeeId: string,
  employeeNumber: number,
): EmployeeNumberPage {
  const items: Item[] = [];
  for (const item of page.items) {
    if (item.employee_id !== employeeId) {
      items.push(item);
      continue;
    }
    const saved = { ...item, employee_number: employeeNumber };
    if (q === null || stillMatches(saved, q, employeeNumber)) items.push(saved);
  }
  return { ...page, items };
}

/** بحث بالأرقام بيطابق الرقم الجديد والصف مش فيه، فالنسخة المحفوظة بقت ناقصة. */
export function newlyMatches(
  page: EmployeeNumberPage,
  q: string | null,
  employeeId: string,
  employeeNumber: number,
): boolean {
  if (q === null || !/^[0-9]+$/.test(q) || Number(q) !== employeeNumber) return false;
  return !page.items.some((item) => item.employee_id === employeeId);
}
