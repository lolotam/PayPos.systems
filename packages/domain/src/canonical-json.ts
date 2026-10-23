/**
 * بيحوّل أي قيمة JSON إلى نص واحد ثابت: مفاتيح كل كائن مرتبة تصاعدياً في كل مستوى، والمصفوفات بترتيبها.
 * القاعدة: نفس المحتوى يدّي نفس النص مهما اختلف ترتيب بناء الكائن، وأي عضو قيمته undefined بيتشال
 * زي JSON.stringify، أما null بتتحفظ لأنها قيمة موجودة.
 *
 * @param value القيمة المراد تسلسلها
 * @returns النص القانوني للقيمة
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
