import { z } from 'zod';
import { responseObject } from '../response-object.js';
import { id } from '../scalars/id.js';

export const requestPackageImportPreviewInput = z
  .strictObject({ file_id: id })
  .meta({ id: 'RequestPackageImportPreviewInput' });
export const packageImportPreviewAccepted = responseObject({ preview_id: id }).meta({
  id: 'PackageImportPreviewAccepted',
});
export const packageImportPreviewRequested = z
  .strictObject({ preview_id: id })
  .meta({ id: 'PackageImportPreviewRequested' });
export const packageImportPreviewRowError = responseObject({
  row: z.number().int().min(2),
  column: z.string().min(1).max(100),
  code: z.enum([
    'IMPORT_CELL_INVALID',
    'IMPORT_PHONE_INVALID',
    'IMPORT_NAME_INVALID',
    'INVALID_PRICE',
    'IMPORT_DATE_INVALID',
    'IMPORT_EXTERNAL_REF_INVALID',
    'IMPORT_REQUIRED_CELL',
    'IMPORT_SERVICE_AMBIGUOUS',
    'IMPORT_SERVICE_NOT_FOUND',
    'INVALID_COMPONENTS',
    'DUPLICATE_SERVICE',
    'INVALID_SESSIONS',
    'INVALID_REMAINING_SESSIONS',
    'IMPORT_CUSTOMER_NOT_FOUND',
    'IMPORT_EXTERNAL_REF_DUPLICATE',
  ]),
}).meta({ id: 'PackageImportPreviewRowError' });
const pending = responseObject({ preview_id: id, status: z.literal('pending') });
const ready = responseObject({
  preview_id: id,
  status: z.literal('ready'),
  row_count: z.number().int().min(0).max(500),
  error_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0).max(500),
  errors: z.array(packageImportPreviewRowError).max(40000),
});
const failed = responseObject({
  preview_id: id,
  status: z.literal('failed'),
  error_code: z.enum([
    'IMPORT_FILE_NOT_FOUND',
    'IMPORT_FILE_NOT_READY',
    'IMPORT_FILE_TYPE_INVALID',
    'IMPORT_FILE_SIZE_INVALID',
    'IMPORT_FILE_CONTENT_INVALID',
    'IMPORT_HEADER_INVALID',
    'IMPORT_ROW_LIMIT_EXCEEDED',
    'STORAGE_UNAVAILABLE',
  ]),
});
export const packageImportPreviewStatus = z
  .discriminatedUnion('status', [pending, ready, failed])
  .meta({ id: 'PackageImportPreviewStatus' });
export type RequestPackageImportPreviewInput = z.infer<typeof requestPackageImportPreviewInput>;
export type PackageImportPreviewRequested = z.infer<typeof packageImportPreviewRequested>;
export type PackageImportPreviewStatus = z.infer<typeof packageImportPreviewStatus>;
export const packageImportPreviewSchemas = [
  requestPackageImportPreviewInput,
  packageImportPreviewAccepted,
  packageImportPreviewRequested,
  packageImportPreviewRowError,
  packageImportPreviewStatus,
];
