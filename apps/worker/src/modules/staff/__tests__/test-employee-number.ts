const nextByCompany = new Map<string, number>();

// فيكستشر الاختبارات بتبدأ من هنا عشان أرقام الإنشاء وMAX+1 تفضل في المدى الصغير من غير ما تتصادم.
const FIRST_TEST_EMPLOYEE_NUMBER = 500_000;
const LAST_EMPLOYEE_NUMBER = 999_999;

export function takeTestEmployeeNumber(companyId: string): number {
  return takeTestEmployeeNumbers(companyId, 1);
}

export function takeTestEmployeeNumbers(companyId: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new Error('TEST_EMPLOYEE_NUMBER_COUNT');
  const start = (nextByCompany.get(companyId) ?? FIRST_TEST_EMPLOYEE_NUMBER - 1) + 1;
  const last = start + count - 1;
  if (last > LAST_EMPLOYEE_NUMBER) throw new Error('TEST_EMPLOYEE_NUMBERS_EXHAUSTED');
  nextByCompany.set(companyId, last);
  return start;
}
