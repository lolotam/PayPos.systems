const MISSING_EMPLOYEE_NUMBER = '\u2014';

/** الرقم يظهر أرقامًا صافية من غير حشو؛ الفاضي «—» عشان شاشة قديمة أو قيمة NULL ما تتكسرش (D-2، TD-10). */
export function displayEmployeeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return MISSING_EMPLOYEE_NUMBER;
  return String(value);
}
