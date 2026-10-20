import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { raw, type HtmlFragment } from '../html/fragment.ts';

const require = createRequire(import.meta.url);

const FACES = [
  { subset: 'arabic', weight: 400 },
  { subset: 'latin', weight: 400 },
  { subset: 'arabic', weight: 700 },
  { subset: 'latin', weight: 700 },
] as const;

let cached: HtmlFragment | undefined;

function packageRoot(): string {
  return dirname(require.resolve('@fontsource/ibm-plex-sans-arabic/package.json'));
}

function subsetRange(subset: string): string {
  // CSS المنشور في 5.3.0 من غير unicode-range؛ الجدول في unicode.json.
  const table = JSON.parse(readFileSync(join(packageRoot(), 'unicode.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const range = table[subset];
  if (typeof range !== 'string' || range.length === 0) throw new Error('FONT_RANGE_MISSING');
  return range;
}

function faceCss(subset: string, weight: number): string {
  const root = packageRoot();
  const range = subsetRange(subset);
  const file = join(root, 'files', `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`);
  const encoded = readFileSync(file).toString('base64');
  return [
    '@font-face{',
    'font-family:"IBM Plex Sans Arabic";',
    'font-style:normal;',
    `font-weight:${String(weight)};`,
    'font-display:swap;',
    `src:url(data:font/woff2;base64,${encoded}) format("woff2");`,
    `unicode-range:${range};`,
    '}',
  ].join('');
}

/**
 * وجوه IBM Plex Sans Arabic المضمّنة. الخط مش بيتحمل من الشبكة وقت الرندر.
 *
 * @returns CSS @font-face للوزنين ٤٠٠ و٧٠٠، عربي ولاتيني
 */
export function fontFaceCss(): HtmlFragment {
  cached ??= raw(FACES.map((face) => faceCss(face.subset, face.weight)).join('\n'));
  return cached;
}
