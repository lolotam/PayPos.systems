/** FORBIDDEN رفض للرقم فقط لو الرقم اتبعت؛ غير كده التنبيه يبقى على الصفحة. */
export function isEmployeeNumberRefusal(error: unknown, numberSent = false): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  if (error.code === 'EMPLOYEE_NUMBER_TAKEN') return true;
  return error.code === 'FORBIDDEN' && numberSent;
}

export function isEmployeeNumberForbidden(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'FORBIDDEN'
  );
}
