import {
  DOCUMENT_BYTES_MAX_BYTES,
  DOCUMENT_HTML_MAX_BYTES,
  DOCUMENT_PDF_MAX_BYTES,
} from '@pospay/contracts';
import { expect, it } from 'vitest';

import { DocumentTooLargeError } from '../domain/errors.ts';
import {
  assertBytesWithinLimit,
  assertHtmlWithinLimit,
  assertPdfWithinLimit,
} from '../domain/limits.ts';
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

it('accepts bytes at the cap and rejects one byte over with the bytes limit', () => {
  const atCap = new Uint8Array(DOCUMENT_BYTES_MAX_BYTES);
  expect(assertBytesWithinLimit(atCap)).toBe(atCap);
  let thrown: unknown;
  try {
    assertBytesWithinLimit(new Uint8Array(DOCUMENT_BYTES_MAX_BYTES + 1));
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(DocumentTooLargeError);
  expect(thrown).toMatchObject({ limit: 'bytes' });
});
