import { SERVICE_IMPORT_CONTENT_TYPE } from './service-import-template.ts';
import { SERVICE_IMPORT_MAX_BYTES } from './service-import.ts';
import { ServiceImportError } from './errors.ts';

/** حقائق الملف الموثّق التي يقرأها الاستيراد من وحدة files على معاملة المستأجر نفسها (072 D-4). */
export interface ServiceImportFileFacts {
  readonly business_id: string;
  readonly created_by: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  readonly storage_key: string | null;
  readonly purged: boolean;
}

/**
 * بيثبت ملكية الملف ووثوقه قبل قراءة بايتاته: الملف المجهول أو الخارج عن النشاط أو غير منشئه
 * أو المنظّف كله رفض «غير موجود» دون كشف وجوده، والملف غير الوثوق أو غير xlsx أو فوق 2 MiB
 * رفض مسمّى خاص به. المسار خاص بالمعاينة لأن المعاينة القراءة الوحيدة للملف (SI-T1).
 *
 * @param facts      حقائق الملف كما قرأتها وحدة files، أو null للمجهول
 * @param businessId النشاط المستهدف في المسار
 * @param userId     منشئ المعاينة المتوقع
 * @returns مفتاح التخزين الصالح للقراءة المحدودة
 */
export function validateServiceImportFile(
  facts: ServiceImportFileFacts | null,
  businessId: string,
  userId: string,
): string {
  if (
    facts === null ||
    facts.purged ||
    facts.business_id !== businessId ||
    facts.created_by !== userId
  )
    throw new ServiceImportError('IMPORT_FILE_NOT_FOUND');
  if (facts.status !== 'READY') throw new ServiceImportError('IMPORT_FILE_NOT_READY');
  if (facts.content_type !== SERVICE_IMPORT_CONTENT_TYPE)
    throw new ServiceImportError('IMPORT_FILE_TYPE_INVALID');
  if (!Number.isSafeInteger(facts.size_bytes) || facts.size_bytes <= 0 || facts.size_bytes > SERVICE_IMPORT_MAX_BYTES)
    throw new ServiceImportError('IMPORT_FILE_SIZE_INVALID');
  if (facts.storage_key === null) throw new ServiceImportError('IMPORT_FILE_NOT_FOUND');
  return facts.storage_key;
}
