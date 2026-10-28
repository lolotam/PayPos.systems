import { expect, it } from 'vitest';

import {
  DOCUMENT_XLSX_MIME_TYPE,
  documentBytesKinds,
  documentKindMimeType,
  documentKindNeedsRenderer,
} from '../../documents-render.js';
import { COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND } from '../statement-exports.js';

it('the export kind is a bytes kind carrying the xlsx MIME type', () => {
  expect(documentBytesKinds[COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND]).toEqual({
    mimeType: DOCUMENT_XLSX_MIME_TYPE,
  });
  expect(documentKindMimeType(COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND)).toBe(
    DOCUMENT_XLSX_MIME_TYPE,
  );
});

it('the export kind needs no PDF renderer', () => {
  expect(documentKindNeedsRenderer(COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND)).toBe(false);
});
