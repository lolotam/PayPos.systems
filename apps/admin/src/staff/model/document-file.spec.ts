import { expect, it } from 'vitest';
import { acceptableDocumentFile, DOCUMENT_MAX_BYTES } from './document-file';

const file = (type: string, size: number) =>
  new File([new Uint8Array(Math.min(size, 16))], 'synthetic', { type }) as File & { size: number };
const sized = (type: string, size: number) =>
  Object.defineProperty(file(type, size), 'size', { value: size });

it('accepts only PDF, JPEG and PNG up to 10 MiB before the upload starts', () => {
  expect(acceptableDocumentFile(sized('application/pdf', 10))).toBe(true);
  expect(acceptableDocumentFile(sized('image/png', DOCUMENT_MAX_BYTES))).toBe(true);
  expect(acceptableDocumentFile(sized('image/png', DOCUMENT_MAX_BYTES + 1))).toBe(false);
  expect(acceptableDocumentFile(sized('image/webp', 10))).toBe(false);
  expect(acceptableDocumentFile(sized('application/pdf', 0))).toBe(false);
  expect(acceptableDocumentFile(null)).toBe(false);
});
