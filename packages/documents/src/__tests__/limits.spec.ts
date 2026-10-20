import { DOCUMENT_HTML_MAX_BYTES, DOCUMENT_PDF_MAX_BYTES } from '@pospay/contracts';
import { expect, it } from 'vitest';

import { DocumentTooLargeError } from '../domain/errors.ts';
import { assertHtmlWithinLimit, assertPdfWithinLimit } from '../domain/limits.ts';
import { html } from '../html/template.ts';

it('rejects HTML and PDF past the contract caps', () => {
  const htmlOver = 'a'.repeat(DOCUMENT_HTML_MAX_BYTES + 1);
  expect(() => assertHtmlWithinLimit(htmlOver)).toThrow(DocumentTooLargeError);
  expect(() => html`${htmlOver}`).toThrow(DocumentTooLargeError);
  const pdfOver = new Uint8Array(DOCUMENT_PDF_MAX_BYTES + 1);
  expect(() => assertPdfWithinLimit(pdfOver)).toThrow(DocumentTooLargeError);
  const pdfOk = assertPdfWithinLimit(new Uint8Array([1]));
  expect(pdfOk).toHaveLength(1);
});
