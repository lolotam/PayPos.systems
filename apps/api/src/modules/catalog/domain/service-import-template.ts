/**
 * تخطيط قالب استيراد الخدمات وحدوده المرجعية (FR-004، A-13، P-3): ثمانية عناوين بترتيبها المرجعي،
 * وورقة مرجعية واحدة بعرض وخمسة أعمدة ثابتة. المساحة المرجعية المحجوزة من ميزانية التوسع هي
 * 35,416 موضعاً بعد حجز شبكة البيانات الممتلئة (6 × 502 × 10 = 30,120 من 65,536)، وسقف صفوف
 * ورقة المرجع هو 6,552 صفاً كما يحسبه حارس XML لنفس الأعمدة. رفض التنزيل الصريح أفضل من ملف
 * لا يُقبل استيراده ولا قالب يقصّ التصنيفات بصمت (جواب المالك، 2026-11-22).
 */
export const SERVICE_IMPORT_TEMPLATE_HEADERS = [
  'name_en',
  'name_ar',
  'price',
  'duration_minutes',
  'category',
  'commission_rule',
  'commission_value',
  'counts_toward_threshold',
] as const;

export type ServiceImportTemplateHeader = (typeof SERVICE_IMPORT_TEMPLATE_HEADERS)[number];

export const SERVICE_IMPORT_TEMPLATE_FILE_NAME = 'services-import-template.xlsx';
export const SERVICE_IMPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** أعمدة ورقة المرجع الخمسة: تصنيف بالإنجليزية وبالعربية وقاعدة العمولة وقيمتها وعلامة الاحتساب. */
export const SERVICE_IMPORT_TEMPLATE_REFERENCE_COLUMNS = 5;

/** صفوف المرجع الثابتة: صف العناوين وأربع قواعد عمولة وسطر كتابات الاحتساب المقبولة. */
export const SERVICE_IMPORT_TEMPLATE_REFERENCE_FIXED_ROWS = 6;

/** المواضع المرجعية الكلية المسموحة بعد حجز شبكة البيانات الممتلئة (A-13/P-3). */
export const SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_POSITIONS = 35_416;

/** سقف صفوف ورقة المرجع كما يحسبه حارس XML عند نفس عرض الأعمدة (P-3). */
export const SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS = 6_552;

/** سبب رفض القالب: سقف الصفوف أو سقف المواضع؛ الرسالة واحدة للمستخدم في الحالين. */
export type ServiceImportTemplateRefusal = 'REFERENCE_ROWS' | 'REFERENCE_POSITIONS';

/** نتيجة فحص سعة القالب: مقبول، أو سبب الرفض المسمّى. */
export type ServiceImportTemplateCapacity =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ServiceImportTemplateRefusal };

/**
 * بيفحص سعة ورقة المرجع قبل بناء المصنف: عدد التصنيفات المفتوحة للنشاط غير محدود، فالقالب
 * بيرفض التنزيل برفض مسمّى لما المساحة المرجعية تتجاوز الحجز الموثّق بدل ما يطلع ملف
 * بيترفض عند الرفع أو يقصّ تصنيفات بصمت (P-3).
 *
 * @param categoryCount عدد التصنيفات المفتوحة في النشاط
 * @returns مقبول، أو سبب الرفض المسمّى
 */
export function serviceImportTemplateCapacity(categoryCount: number): ServiceImportTemplateCapacity {
  const rows = SERVICE_IMPORT_TEMPLATE_REFERENCE_FIXED_ROWS + categoryCount;
  if (rows > SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS) return { ok: false, reason: 'REFERENCE_ROWS' };
  const positions = rows * SERVICE_IMPORT_TEMPLATE_REFERENCE_COLUMNS;
  if (positions > SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_POSITIONS)
    return { ok: false, reason: 'REFERENCE_POSITIONS' };
  return { ok: true };
}
