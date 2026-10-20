import { DOCUMENT_PDF_MAX_BYTES } from '@pospay/contracts';
import { chromium } from 'playwright-core';
import { expect, it } from 'vitest';

import { fixtureDocument } from '../html/fixture.ts';
import { PlaywrightDocumentRenderer } from '../playwright/renderer.ts';
import { realChromiumUnavailable } from './chromium-gate.ts';
import { pdfText } from './pdf-text.ts';

const QUIET_BODY = 'QUIET_BODY_7c1';
const QUIET_TITLE = 'QUIET_TITLE_7c1';
const RAN = 'JS_RAN_9f3a2c';
const HOSTILE_SCRIPT = `<!doctype html><html><head><title>${QUIET_TITLE}</title>
<script>document.title='${RAN}';document.getElementById('quiet').textContent='${RAN}'</script>
</head><body><p id="quiet">${QUIET_BODY}</p></body></html>`;
const HOSTILE_NETWORK = `<!doctype html><html><head>
<link rel="stylesheet" href="https://example.invalid/sheet.css">
<style>@font-face{font-family:X;src:url(https://example.invalid/font.woff2)} body{font-family:X}</style>
</head><body><img src="https://example.invalid/pixel.png" alt=""></body></html>`;

async function chromiumInstalled(): Promise<boolean> {
  try {
    const browser = await chromium.launch({
      chromiumSandbox: false,
      timeout: 15_000,
      args: ['--disable-dev-shm-usage', '--disable-gpu'],
    });
    await browser.close();
    return true;
  } catch (error) {
    return realChromiumUnavailable(error);
  }
}

const chromiumReady = await chromiumInstalled();

async function rendered(
  html: string,
  onDocumentHtml?: (outerHtml: string) => void,
): Promise<Uint8Array> {
  const renderer = new PlaywrightDocumentRenderer(
    onDocumentHtml === undefined ? {} : { onDocumentHtml },
  );
  await renderer.start();
  try {
    expect(renderer.isAvailable()).toBe(true);
    return await renderer.render(html);
  } finally {
    await renderer.close();
  }
}

it.skipIf(!chromiumReady)(
  'renders Arabic and English fixtures with the embedded font',
  async () => {
    for (const language of ['ar', 'en'] as const) {
      const pdf = await rendered(fixtureDocument({ language, lines: ['Line 1', 'سطر'] }));
      expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
      expect(pdf.byteLength).toBeLessThanOrEqual(DOCUMENT_PDF_MAX_BYTES);
      expect(pdfText(pdf)).toMatch(/IBMPlexSansArabic|IBM Plex Sans Arabic/);
    }
  },
);

it.skipIf(!chromiumReady)('C2 keeps an inline script from changing the document', async () => {
  let outer = '';
  const pdf = await rendered(HOSTILE_SCRIPT, (html) => {
    outer = html;
  });
  expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
  expect(outer).toContain(`<title>${QUIET_TITLE}</title>`);
  expect(outer).toContain(`<p id="quiet">${QUIET_BODY}</p>`);
  expect(outer).not.toContain(`<title>${RAN}</title>`);
  expect(outer).not.toContain(`<p id="quiet">${RAN}</p>`);
  const text = pdfText(pdf);
  expect(text).toContain(QUIET_BODY);
  expect(text).not.toContain(RAN);
});

it.skipIf(!chromiumReady)('C3 aborts the external image, stylesheet and font', async () => {
  const renderer = new PlaywrightDocumentRenderer();
  await renderer.start();
  try {
    const aborted: string[] = [];
    const pdf = await renderer.render(HOSTILE_NETWORK, {
      onAbortedRequest: (url) => {
        aborted.push(url);
      },
    });
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(aborted).toContain('https://example.invalid/sheet.css');
    expect(aborted).toContain('https://example.invalid/font.woff2');
    expect(aborted).toContain('https://example.invalid/pixel.png');
  } finally {
    await renderer.close();
  }
});
