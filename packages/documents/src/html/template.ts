import { escapeHtml } from '../domain/escape.ts';
import { assertHtmlWithinLimit } from '../domain/limits.ts';
import { isHtmlFragment, raw, type HtmlFragment } from './fragment.ts';

export type HtmlSlot = string | number | bigint | HtmlFragment | readonly HtmlSlot[];

function plainText(value: object): string {
  if ('value' in value && typeof value.value === 'string') return value.value;
  return String(value);
}

function insert(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => insert(item)).join('');
  if (isHtmlFragment(value)) return value.value;
  if (typeof value === 'object' && value !== null) return escapeHtml(plainText(value));
  return escapeHtml(String(value));
}

/**
 * قالب موسوم. كل قيمة من برّه بتتهرب؛ القطع الموسومة بس هي اللي بتنزل كما هي.
 * كائن شكله زي القطعة من غير العلامة بيتكتب كنص مهروب، عشان الطلب ما يزوّرش raw.
 *
 * @param strings الأجزاء الثابتة من القالب
 * @param values القيم المقحمة، ونصها غير موثوق
 * @returns قطعة HTML موسومة، أو يرمي لو الناتج عدّى سقف الـ HTML
 */
export function html(strings: TemplateStringsArray, ...values: readonly unknown[]): HtmlFragment {
  let out = '';
  strings.forEach((part, index) => {
    out += part;
    const value = values[index];
    if (value !== undefined) out += insert(value);
  });
  assertHtmlWithinLimit(out);
  return raw(out);
}
