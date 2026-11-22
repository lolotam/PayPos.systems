import { SERVICE_IMPORT_CONTENT_TYPE } from './service-import-template.ts';
import { SERVICE_IMPORT_MAX_BYTES } from './service-import.ts';
import { ServiceImportError } from './errors.ts';

/** حقائق الملف الموثّق التي يقرأها الاستيراد من وحدة files على معاملة المستأجر نفسها (072 D-4). */
export interface ServiceImportFileFacts {
  readonly business_id: string;
  readonly created_by: string;
  readonly owner_module: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly status: 'PENDING' | 'VERIFYING' | 'READY' | 'REJECTED';
  readonly storage_key: string | null;
  readonly purged: boolean;
  readonly purge_started: boolean;
}

/** الغرض الوحيد المقبول لملف معاينة الاستيراد؛ رفع غير مخصص للكتالوج رفض «غير موجود». */
export const SERVICE_IMPORT_OWNER_MODULE = 'catalog';

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
  // مطابقة المعرفات بأحرف صغيرة: الـguard يقبل UUID بأي حالة والقاعدة تخزنها صغيرة،
  // فطلب بأحرف مختلطة يطابق الملكية فعلاً ولا يُرفض 404 خطأً (P2 مراجعة 1186).
  if (
    facts === null ||
    facts.purged ||
    // بدء الحذف يخفي الملف عن حالة files فورًا؛ المعاينة ترفضه قبل قراءة أي بايت (P2 مراجعة 32b-2).
    facts.purge_started ||
    // غرض الرفع: ملفات رفعها workflow آخر لا تصل لقارئ الكتالوج حتى لو طابقت المالك والنوع (P2 مراجعة 1186).
    facts.owner_module !== SERVICE_IMPORT_OWNER_MODULE ||
    facts.business_id.toLowerCase() !== businessId.toLowerCase() ||
    facts.created_by.toLowerCase() !== userId.toLowerCase()
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
