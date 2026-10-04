/**
 * بيحوّل قيمة JSON لنص ثابت: مفاتيح كل object مترتبة، والـ arrays بترتيبها، فنفس المحتوى يدّي نفس النص
 * مهما كان ترتيب بناء الـ object. المفاتيح اللي قيمتها undefined بتتشال زي JSON.stringify.
 * أي قيمة مش JSON (bigint، function، رقم مش finite) بترمي TypeError بدل ما تتحول بصمت.
 *
 * @param value القيمة اللي هتتسلسل
 * @returns النص الـ canonical
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const prototype: unknown = typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (prototype === Object.prototype || prototype === null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
}
