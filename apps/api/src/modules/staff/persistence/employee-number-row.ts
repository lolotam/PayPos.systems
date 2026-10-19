export function storedNumber(value: number | string | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' ? value : Number(value);
}

/** رقم الموظفة بعد 8c-11؛ بداية العدّاد ما زالت تستخدم storedNumber لأنها قد تغيب. */
export function requiredStoredNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value);
}

export function retryableDatabaseCode(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (
    let current: unknown = error;
    typeof current === 'object' && current !== null && !seen.has(current);
    current = (current as { cause?: unknown }).cause
  ) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (code !== undefined) {
      const sqlState = String(code);
      return sqlState === '40001' || sqlState === '40P01' || sqlState === '55P03';
    }
  }
  return false;
}
