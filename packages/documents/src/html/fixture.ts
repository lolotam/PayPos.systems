import { baseLayout, bdi } from './layout.ts';
import { html, type HtmlSlot } from './template.ts';

export interface FixtureInput {
  readonly language: 'ar' | 'en';
  readonly lines: readonly string[];
}

/**
 * مستند تجريبي للدخان والاختبار. السطور نص طالب، فبتمر من الهروب مش كـ HTML خام.
 *
 * @param input اللغة وسطور الجسم
 * @returns HTML كامل
 */
export function fixtureDocument(input: FixtureInput): string {
  const title = input.language === 'ar' ? 'مستند تجريبي' : 'Sample document';
  const footer = input.language === 'ar' ? 'نهاية المستند' : 'End of document';
  const body = html`<main>
    ${input.lines.map((line) => html`<p>${lineSlot(line, input.language)}</p>`)}
  </main>`;
  return baseLayout({
    language: input.language,
    title,
    body,
    footer: html`<span>${footer}</span>`,
  }).value;
}

/** سطر فيه حروف لاتينية جوّه صفحة عربية بيتلف لوحده. السطر العربي يفضل نص مهروب من غير وسم زيادة. */
function lineSlot(line: string, language: 'ar' | 'en'): HtmlSlot {
  if (language === 'ar' && /[A-Za-z]/.test(line)) return bdi(line);
  return line;
}
