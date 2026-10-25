import { expect, it } from 'vitest';

import {
  DOCUMENT_PDF_MIME_TYPE,
  DOCUMENT_XLSX_MIME_TYPE,
  documentKindMimeType,
  documentKindNeedsRenderer,
  documentRenderJob,
} from '../documents-render.js';

it('requires the renderer only for PDF kinds', () => {
  expect(documentKindNeedsRenderer('commission-statement-xlsx')).toBe(false);
  expect(documentKindNeedsRenderer('attendance-statement')).toBe(true);
  expect(documentKindNeedsRenderer('fixture')).toBe(true);
});

it('returns the MIME type of a bytes kind and PDF otherwise', () => {
  expect(documentKindMimeType('commission-statement-xlsx')).toBe(DOCUMENT_XLSX_MIME_TYPE);
  expect(documentKindMimeType('attendance-statement')).toBe(DOCUMENT_PDF_MIME_TYPE);
  expect(documentKindMimeType('fixture')).toBe(DOCUMENT_PDF_MIME_TYPE);
});

it('accepts an injected bytes-kind map', () => {
  const bytesKinds = { fixtureXlsx: { mimeType: 'application/x-fixture' } };
  expect(documentKindNeedsRenderer('fixtureXlsx', bytesKinds)).toBe(false);
  expect(documentKindNeedsRenderer('commission-statement-xlsx', bytesKinds)).toBe(true);
  expect(documentKindMimeType('fixtureXlsx', bytesKinds)).toBe('application/x-fixture');
  expect(documentKindMimeType('commission-statement-xlsx', bytesKinds)).toBe(
    DOCUMENT_PDF_MIME_TYPE,
  );
});

it('keeps document kinds as non-empty free strings up to 64 characters', () => {
  const base = {
    company_id: '00000000-0000-7000-8000-000000000001',
    render_id: '00000000-0000-7000-8000-000000000002',
  };
  for (const kind of [
    'fixture',
    'commission-statement-xlsx',
    'a kind with spaces',
    'x'.repeat(64),
  ]) {
    expect(documentRenderJob.safeParse({ ...base, kind }).success).toBe(true);
  }
  expect(documentRenderJob.safeParse({ ...base, kind: '' }).success).toBe(false);
  expect(documentRenderJob.safeParse({ ...base, kind: 'x'.repeat(65) }).success).toBe(false);
});
