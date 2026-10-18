import { parseEmployeeNumber } from '@pospay/domain';

// القص مرة واحدة حتى يبقى نص خانة قائمة الموظفين ورقمها من نفس القيمة.
export function employeeListSearch(q: string | undefined): { text: string; number: number | null } | undefined {
  if (q === undefined) return undefined;
  const text = q.trim();
  return { text, number: parseEmployeeNumber(text) };
}
