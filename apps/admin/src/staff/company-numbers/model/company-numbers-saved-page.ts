import type { EmployeeNumberPage } from '@pospay/contracts';
import {
  newlyMatches as matchesSavedNumber,
  withSavedNumber as pageWithSavedNumber,
} from '../../model/saved-number-page';

type Item = EmployeeNumberPage['items'][number];

const companyIdOf = (item: Item) => item.employee_id;

/** صفحة القائمة بعد حفظ رقم: الصف بيتحدّث، وبيخرج من صفحة بحث بالأرقام لو مابقاش مطابق. */
export function withSavedNumber(
  page: EmployeeNumberPage,
  q: string | null,
  employeeId: string,
  employeeNumber: number,
): EmployeeNumberPage {
  return pageWithSavedNumber(page, q, employeeId, employeeNumber, companyIdOf);
}

/** بحث بالأرقام بيطابق الرقم الجديد والصف مش فيه، فالنسخة المحفوظة بقت ناقصة. */
export function newlyMatches(
  page: EmployeeNumberPage,
  q: string | null,
  employeeId: string,
  employeeNumber: number,
): boolean {
  return matchesSavedNumber(page, q, employeeId, employeeNumber, companyIdOf);
}
