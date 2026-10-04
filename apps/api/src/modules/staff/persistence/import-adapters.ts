import type {
  ImportSheetReader,
  ImportTemplateBuilder,
  ObjectBytesReader,
} from '../ports/employee-import.port.ts';
import { buildEmployeeImportTemplate } from './employee-import-template.ts';
import { readWorkbookMatrix } from './xlsx-sheet-reader.ts';
import { EmployeeImportError } from '../domain/employee-import.ts';

export function createImportSheetReader(): ImportSheetReader {
  return { read: (bytes) => readWorkbookMatrix(bytes) };
}

export function createImportTemplateBuilder(): ImportTemplateBuilder {
  return {
    build: async (branches) =>
      Buffer.from(await buildEmployeeImportTemplate(branches)).toString('base64'),
  };
}

export function createObjectBytesReader(storage: {
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}): ObjectBytesReader {
  return {
    read: async (key, maxBytes) => {
      try {
        return await storage.read(key, maxBytes);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          ['FILE_SIZE_INVALID', 'FILE_CONTENT_INVALID'].includes(String(error.code))
        )
          throw new EmployeeImportError('IMPORT_FILE_CONTENT_INVALID');
        throw new EmployeeImportError('STORAGE_UNAVAILABLE');
      }
    },
  };
}
