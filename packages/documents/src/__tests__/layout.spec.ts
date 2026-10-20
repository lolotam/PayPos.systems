import { expect, it } from 'vitest';

import { imageDataUri } from '../html/image.ts';
import { baseLayout, bdi } from '../html/layout.ts';
import { html } from '../html/template.ts';
import { fixtureDocument } from '../html/fixture.ts';

const PHYSICAL =
  /(?:margin|padding|border)-(?:left|right)\b|(?:^|[^-])(?:left|right)\s*:|text-align\s*:\s*(?:left|right)/;
const EXTERNAL = /(?:src|href)\s*=\s*["'](?!data:)|\burl\(\s*['"]?(?!data:)/;

it('lays out Arabic and English with logical CSS and an embedded font', () => {
  const arabic = baseLayout({
    language: 'ar',
    title: '<title>',
    body: html`<p>${'سطر'}</p>`,
  }).value;
  expect(arabic.startsWith('<!doctype html>')).toBe(true);
  expect(arabic).toContain('<html lang="ar" dir="rtl">');
  expect(arabic).toContain('@page { size: A4; margin: 16mm; }');
  expect(arabic).toContain('data:font/woff2;base64,');
  expect(arabic).toContain('IBM Plex Sans Arabic');
  expect(arabic).toContain('&lt;title&gt;');
  expect(arabic).not.toMatch(PHYSICAL);
  expect(arabic).not.toMatch(EXTERNAL);
  const english = fixtureDocument({ language: 'en', lines: ['One & two'] });
  expect(english).toContain('<html lang="en" dir="ltr">');
  expect(english).toContain('One &amp; two');
  expect(english).not.toMatch(EXTERNAL);
});

it('wraps a Latin line in bdi and escapes it', () => {
  expect(bdi('A<B>&"').value).toBe('<bdi>A&lt;B&gt;&amp;&quot;</bdi>');
  const arabic = fixtureDocument({ language: 'ar', lines: ['INV <1>', 'سطر'] });
  expect(arabic).toContain('<bdi>INV &lt;1&gt;</bdi>');
  expect(arabic).toContain('<p>سطر</p>');
  expect(arabic).not.toContain('<p>INV');
});

it('builds image data URIs only for png and jpeg', () => {
  const png = imageDataUri(Uint8Array.from([1, 2, 3]), 'image/png');
  expect(png.value.startsWith('data:image/png;base64,')).toBe(true);
  const jpeg = imageDataUri(Uint8Array.from([4]), 'image/jpeg');
  expect(jpeg.value.startsWith('data:image/jpeg;base64,')).toBe(true);
  expect(() => imageDataUri(Uint8Array.from([1]), 'image/gif' as 'image/png')).toThrow(
    'DOCUMENT_IMAGE_MIME',
  );
});
