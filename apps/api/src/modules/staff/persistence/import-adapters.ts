import type {
  ImportSheetReader,
  ImportTemplateBuilder,
  ObjectBytesReader,
} from '../ports/employee-import.port.ts';
import { buildEmployeeImportTemplate } from './employee-import-template.ts';
import { readWorkbookMatrix } from './xlsx-sheet-reader.ts';

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
  return { read: (key, maxBytes) => storage.read(key, maxBytes) };
}
