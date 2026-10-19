import type { EmployeeListItem, EmployeePage } from '@pospay/contracts';
import type { QueryClient } from '@tanstack/react-query';

type NumberedName = {
  name_ar: string | null;
  name_en: string;
  employee_number: number;
};

type NumberPage<T extends NumberedName> = {
  items: readonly T[];
  next_cursor: string | null;
};

// الأرقام بس بتطابق الرقم بالظبط أو اسم فيه نفس الأرقام (EN-Q16)؛ أي نص تاني بيطابق الاسم، والاسم ما اتغيّرش.
function stillMatches(item: NumberedName, q: string, employeeNumber: number): boolean {
  if (!/^[0-9]+$/.test(q)) return true;
  if (Number(q) === employeeNumber) return true;
  return [item.name_ar, item.name_en].some((name) => name?.includes(q) ?? false);
}

/** صفحة القائمة بعد حفظ رقم: الصف بيتحدّث، وبيخرج من صفحة بحث بالأرقام لو مابقاش مطابق. */
export function withSavedNumber<T extends NumberedName>(
  page: NumberPage<T>,
  q: string | null,
  employeeId: string,
  employeeNumber: number,
  idOf: (item: T) => string,
): { items: T[]; next_cursor: string | null } {
  const items: T[] = [];
  for (const item of page.items) {
    if (idOf(item) !== employeeId) {
      items.push(item);
      continue;
    }
    const saved = { ...item, employee_number: employeeNumber };
    if (q === null || stillMatches(saved, q, employeeNumber)) items.push(saved);
  }
  return { ...page, items };
}

/** بحث بالأرقام بيطابق الرقم الجديد والصف مش فيه، فالنسخة المحفوظة بقت ناقصة. */
export function newlyMatches<T extends NumberedName>(
  page: NumberPage<T>,
  q: string | null,
  employeeId: string,
  employeeNumber: number,
  idOf: (item: T) => string,
): boolean {
  if (q === null || !/^[0-9]+$/.test(q) || Number(q) !== employeeNumber) return false;
  return !page.items.some((item) => idOf(item) === employeeId);
}

// مفتاح القائمة: list ثم الـ cursor ثم q لو البحث موجود. بحث بالأرقام هو q نفسه.
function staffListSearch(queryKey: readonly unknown[]): string | null {
  const listAt = queryKey.indexOf('list');
  const search = listAt < 0 ? undefined : queryKey[listAt + 2];
  return typeof search === 'string' ? search : null;
}

const staffIdOf = (item: EmployeeListItem) => item.id;

/** كل صفحة موظفين ببحثها: بحث بالأرقام بيطلّع الصف، وصفحة الرقم الجديد المقفولة بتتشال. */
export function applySavedEmployeeLists(
  client: QueryClient,
  root: readonly unknown[],
  employeeId: string,
  employeeNumber: number,
): void {
  for (const [queryKey, page] of client.getQueriesData<EmployeePage>({
    queryKey: [...root, 'list'],
  })) {
    if (!page) continue;
    const q = staffListSearch(queryKey);
    client.setQueryData(queryKey, withSavedNumber(page, q, employeeId, employeeNumber, staffIdOf));
    if (newlyMatches(page, q, employeeId, employeeNumber, staffIdOf)) {
      client.removeQueries({ queryKey, exact: true, type: 'inactive' });
    }
  }
}
