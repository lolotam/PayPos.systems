/** فشل fixture ناقصة يوقف الاختبار بدل إخفائه وراء assertion للنوع. */
export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('SYNTHETIC_FIXTURE_MISSING');
  return value;
}
