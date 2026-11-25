import type { ServiceImportStatus } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';

type ServiceImportStatusErrorCode = NonNullable<ServiceImportStatus['error_code']>;

// الكودان الخاصان بالخدمات في قسم الاستيراد، وباقي أكواد الملف في قسم الأخطاء العام.
const STATUS_ERROR_MESSAGE: Record<ServiceImportStatusErrorCode, MessageKey> = {
  IMPORT_SERVICE_EXISTS: 'catalogServiceImport.code_IMPORT_SERVICE_EXISTS',
  IMPORT_CATEGORY_NOT_FOUND: 'catalogServiceImport.code_IMPORT_CATEGORY_NOT_FOUND',
  IMPORT_PREVIEW_EXPIRED: 'errors.IMPORT_PREVIEW_EXPIRED',
  IMPORT_PREVIEW_HAS_ERRORS: 'errors.IMPORT_PREVIEW_HAS_ERRORS',
  IMPORT_COMMIT_FAILED: 'errors.IMPORT_COMMIT_FAILED',
};

/**
 * يختار مفتاح رسالة كود نتيجة المعاينة، فتبقى الرسالة في اللغتين ومترجمة من i18n.
 *
 * @param code كود النتيجة كما ورد من الـ API
 * @returns مفتاح الرسالة
 */
export function serviceImportStatusErrorMessage(code: ServiceImportStatusErrorCode): MessageKey {
  return STATUS_ERROR_MESSAGE[code];
}
