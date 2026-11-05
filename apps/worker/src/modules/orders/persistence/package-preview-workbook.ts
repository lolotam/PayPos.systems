import { ImportWorkbookError, readWorkbookMatrix, readSheet } from '@pospay/import-workbooks';
import { PACKAGE_IMPORT_BOUNDS, PackageImportError } from '../domain/package-import.ts';
import { PACKAGE_IMPORT_HEADERS } from '../domain/package-import-row.ts';
import type { PackagePreviewWorkbook } from '../ports/package-preview.port.ts';

export function packagePreviewWorkbook(
  readBytes: (key: string, maxBytes: number) => Promise<Uint8Array | null>,
): PackagePreviewWorkbook {
  return {
    read: async (key) => {
      const bytes = await readBytes(key, PACKAGE_IMPORT_BOUNDS.maxBytes + 1);
      if (bytes === null) throw new PackageImportError('IMPORT_FILE_NOT_FOUND');
      let matrix;
      try {
        matrix = await readWorkbookMatrix(bytes, PACKAGE_IMPORT_BOUNDS);
      } catch (error) {
        if (error instanceof ImportWorkbookError) throw new PackageImportError(error.code);
        throw error;
      }
      const sheet = readSheet(matrix, PACKAGE_IMPORT_HEADERS, PACKAGE_IMPORT_BOUNDS.maxDataRows);
      if (typeof sheet === 'string') throw new PackageImportError(sheet);
      if (
        sheet.rows.some(({ cells }) =>
          cells
            .slice(PACKAGE_IMPORT_HEADERS.length)
            .some((cell) => cell !== null && String(cell).trim() !== ''),
        )
      )
        throw new PackageImportError('IMPORT_HEADER_INVALID');
      return {
        rows: sheet.rows.map((source) => ({
          row: source.row,
          cells: PACKAGE_IMPORT_HEADERS.map(
            (header) => source.cells[sheet.headers.indexOf(header)] ?? null,
          ),
        })),
      };
    },
  };
}
