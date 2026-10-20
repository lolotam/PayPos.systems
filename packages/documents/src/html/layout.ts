import { escapeHtml } from '../domain/escape.ts';
import { fontFaceCss } from '../fonts/ibm-plex.ts';
import { raw, type HtmlFragment } from './fragment.ts';
import { html } from './template.ts';

export interface LayoutInput {
  readonly language: 'ar' | 'en';
  readonly title: string;
  readonly body: HtmlFragment;
  readonly footer?: HtmlFragment;
}

const PAGE_CSS = [
  '@page { size: A4; margin: 16mm; }',
  'html, body { margin: 0; }',
  'body { font-family: "IBM Plex Sans Arabic", sans-serif; font-weight: 400; }',
  'h1 { font-weight: 700; margin-block: 0 6mm; }',
  'main { margin-inline: 0; }',
  'footer { margin-block-start: 8mm; }',
].join('\n');

/**
 * بيعزل مقطع لاتيني جوّه سطر عربي عشان الأرقام والاختصارات ما تنعكسش مع اتجاه الصفحة.
 * القيمة بتتهرب قبل الوسم؛ الوسم نفسه من القالب مش من الطلب.
 *
 * @param value المقطع كما كتبه الطالب
 * @returns القطعة جوّه bdi
 */
export function bdi(value: string): HtmlFragment {
  return raw(`<bdi>${escapeHtml(value)}</bdi>`);
}

/**
 * الهيكل المطبوع: اتجاه اللغة، خط مضمّن، وحواف صفحة منطقية.
 * العنوان نص مهروب؛ الجسم والتذييل قطع اتبنت جوّه القالب.
 *
 * @param input اللغة والعنوان والجسم وتذييل اختياري
 * @returns مستند HTML كامل
 */
export function baseLayout(input: LayoutInput): HtmlFragment {
  const direction = input.language === 'ar' ? 'rtl' : 'ltr';
  const footer = input.footer ?? raw('');
  return html`<!doctype html>
    <html lang="${input.language}" dir="${direction}">
      <head>
        <meta charset="utf-8" />
        <title>${input.title}</title>
        <style>
          ${fontFaceCss()}
          ${raw(PAGE_CSS)}
        </style>
      </head>
      <body>
        ${input.body}
        <footer>${footer}</footer>
      </body>
    </html>`;
}
