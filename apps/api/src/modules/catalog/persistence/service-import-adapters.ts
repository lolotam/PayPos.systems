import { readWorkbookSheet, ImportWorkbookError } from '../../../shared/import/xlsx-sheet-reader.ts';
import { SERVICE_IMPORT_MAX_BYTES, SERVICE_IMPORT_MAX_COLUMNS, SERVICE_IMPORT_MAX_DATA_ROWS } from '../domain/service-import.ts';
import { ServiceImportError } from '../domain/errors.ts';
import type { ServiceImportFileFacts } from '../domain/service-import-file.ts';
import type {
  ServiceImportFileFactsPort,
  ServiceImportObjectBytes,
  ServiceImportSheetReader,
} from '../ports/service-import.port.ts';

/** ما تحتاجه ربطات files من التخزين: قراءة بايتات محدودة بمفتاح داخلي. */
export interface ServiceImportStorageReader {
  read(key: string, maxBytes: number): Promise<Uint8Array>;
}

/** ربطات الملفات التي يبنيها التركيب الجذري في app.ts من وحدة files بلا سهم استيراد نحوها. */
export interface ServiceImportFilesBinding {
  readonly fileFacts: ServiceImportFileFactsPort;
  readonly bytes: ServiceImportObjectBytes | null;
}

// حدود القراءة نفسها المعلنّة للكيان؛ القارئ هو حماية الحد الواحد (A-13).
const READER_BOUNDS = {
  maxBytes: SERVICE_IMPORT_MAX_BYTES,
  maxDataRows: SERVICE_IMPORT_MAX_DATA_ROWS,
  maxColumns: SERVICE_IMPORT_MAX_COLUMNS,
  maxWorksheets: 2,
};

/**
 * يبني قارئ الورقة على الحزمة المشتركة ويرجم رفض القارئ التقني إلى رفض كيان مسمّى،
 * فلا تسرّب تفاصيل الملف الخام ولا يتحول رفض الحد إلى محتوى غير صالح.
 */
export function createServiceImportSheetReader(): ServiceImportSheetReader {
  return {
    read: async (bytes) => {
      try {
        return await readWorkbookSheet(bytes, READER_BOUNDS);
      } catch (error) {
        if (error instanceof ImportWorkbookError) {
          if (error.code === 'IMPORT_ROW_LIMIT_EXCEEDED')
            throw new ServiceImportError('IMPORT_ROW_LIMIT_EXCEEDED');
          throw new ServiceImportError('IMPORT_FILE_CONTENT_INVALID');
        }
        throw error;
      }
    },
  };
}

/**
 * يربط حقائق الملف وقراءة البايتات بمنفذي الكتالوج من مكونات files الممرّرة من app.ts (P-4):
 * فشل التخزين المسمّى رفض محتوى، وغيره تعذّر تخزين، والتخزين غير المهيأ يعطّل المعاينة وحدها.
 *
 * @param storage قارئ التخزين من وحدة files، أو null قبل تهيئتها
 * @param facts   قارئ حقائق الملف على معاملة المستأجر ببصمة وحدة files نفسها
 * @returns الربطتين أو null بلا تخزين
 */
export function bindServiceImportFiles(
  storage: ServiceImportStorageReader | null,
  facts:
    | ((tx: never, companyId: string, fileId: string) => Promise<ServiceImportFileFacts | null>)
    | null,
): ServiceImportFilesBinding {
  return {
    fileFacts: {
      facts: (tx, companyId, fileId) =>
        facts === null ? Promise.resolve(null) : facts(tx as never, companyId, fileId),
    },
    bytes:
      storage === null
        ? null
        : {
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
                  throw new ServiceImportError('IMPORT_FILE_CONTENT_INVALID');
                throw new ServiceImportError('STORAGE_UNAVAILABLE');
              }
            },
          },
  };
}
