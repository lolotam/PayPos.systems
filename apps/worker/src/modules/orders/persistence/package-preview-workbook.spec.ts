import { expect, it } from 'vitest';
import { PACKAGE_IMPORT_BOUNDS } from '../domain/package-import.ts';
import { packagePreviewWorkbook } from './package-preview-workbook.ts';

it('rejects oversized storage bytes with the size code before parsing invalid XLSX content', async () => {
  const workbook = packagePreviewWorkbook(
    async () => new Uint8Array(PACKAGE_IMPORT_BOUNDS.maxBytes + 1),
  );
  await expect(workbook.read('synthetic-preview.xlsx')).rejects.toMatchObject({
    code: 'IMPORT_FILE_SIZE_INVALID',
  });
});
