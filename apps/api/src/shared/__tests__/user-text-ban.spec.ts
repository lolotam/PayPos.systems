import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Plan T10-1 / CLAUDE.md §7: text a user reads lives in packages/i18n. Arabic in any string — plain, escaped, in a
// template, between JSX tags, or in a presentation form — is refused elsewhere, linted with the API's real config.
const api = fileURLToPath(new URL('../../..', import.meta.url));
const linter = new ESLint({ cwd: api });
const refused = async (source: string, file = 'src/shared/probe.ts') => {
  const [result] = await linter.lintText(source, { filePath: `${api}/${file}` });
  return (result?.messages ?? []).some((m) => /belongs in packages\/i18n/.test(m.message));
};
// Built from code points, so the sources below say exactly what they test whatever the editor does with escapes.
const letters = (...codes: number[]) => String.fromCharCode(...codes);
const BACKSLASH = String.fromCharCode(92);
const escaped = (...codes: number[]) =>
  codes.map((c) => `${BACKSLASH}u${c.toString(16).padStart(4, '0')}`).join('');
const SAVE = [0x062d, 0x0641, 0x0638];

describe('Arabic text belongs in packages/i18n', () => {
  it.each([
    ['a plain string', `export const label = '${letters(...SAVE)}';\n`],
    ['an escaped string', `export const label = '${escaped(...SAVE)}';\n`],
    ['a template', `export const label = \`${letters(...SAVE)} \${1}\`;\n`],
    ['an escaped template', `export const label = \`${escaped(...SAVE)}\`;\n`],
    ['a presentation-form ligature', `export const label = '${letters(0xfefb)}';\n`],
    ['Arabic Supplement', `export const label = '${letters(0x0750)}';\n`],
  ])('refuses %s', async (_name, source) => {
    expect(await refused(source)).toBe(true);
  });

  it('refuses Arabic between JSX tags', async () => {
    const source = `export const Save = () => <button>${letters(...SAVE)}</button>;\n`;
    expect(await refused(source, 'src/shared/probe.tsx')).toBe(true);
  });

  it('allows English, and Arabic in a comment', async () => {
    expect(await refused(`// ${letters(...SAVE)}\nexport const label = 'Save';\n`)).toBe(false);
  });
});
