const ESCAPED: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * بيهرب نص داخل HTML عشان طلب العميل ما يبقاش وسم.
 * الترتيب مش مهم هنا لأن الاستبدال مرة واحدة وما بيعيدش قراءة الناتج.
 *
 * @param value النص الخام
 * @returns النص بعد استبدال & < > " '
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPED[character] ?? character);
}
