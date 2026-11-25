/** عدد مجموعات الخدمات القصوى في الصف الواحد؛ كل مجموعة ثلاثة أعمدة: الخدمة وإجمالي الجلسات والمتبقي. */
export const PACKAGE_IMPORT_TEMPLATE_GROUPS = 20;

/**
 * عناوين ورقة بيانات قالب استيراد الباقات بترتيبها المرجعي: ستة أعمدة ثابتة ثم عشرون مجموعة خدمات.
 * يطابق ترتيب PACKAGE_IMPORT_HEADERS في العامل حرفاً بحرف، وإلا رُفض المصنف المنزّل عند المعاينة (047-1).
 */
export const PACKAGE_IMPORT_TEMPLATE_HEADERS: readonly string[] = [
  'customer_phone',
  'name_en',
  'name_ar',
  'price_paid',
  'expires_on',
  'external_ref',
  ...Array.from({ length: PACKAGE_IMPORT_TEMPLATE_GROUPS }, (_, index) => [
    `service_${index + 1}`,
    `sessions_${index + 1}`,
    `remaining_${index + 1}`,
  ]).flat(),
];

/** حدود القارئ المحمي نفسها التي تطبقها معاينة العامل على المصنف المرفوع (47-1b)، فيمر القالب المنزّل عليها كما هو. */
export const PACKAGE_IMPORT_TEMPLATE_BOUNDS = {
  maxBytes: 2 * 1024 * 1024,
  maxDataRows: 500,
  maxColumns: 68,
  maxWorksheets: 4,
} as const;

/** اسم ملف القالب المنزّل. */
export const PACKAGE_IMPORT_TEMPLATE_FILE_NAME = 'packages-import-template.xlsx';
/** نوع المحتوى الوحيد للمصنف: xlsx، وهو نفسه الذي تقبله المعاينة عند الرفع. */
export const PACKAGE_IMPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** أعمدة ورقة الخدمات المرجعية: اسم الخدمة بالإنجليزية وبالعربية. */
export const PACKAGE_IMPORT_TEMPLATE_REFERENCE_COLUMNS = 2;

/**
 * ميزانية توسّع حارس XML ومساحاتها بعد حجز شبكة البيانات الممتلئة (502 صفاً × 66 عموداً)، وسقف صفوف
 * ورقة المرجع كما يحسبه الحارس نفسه لعرض 68 عموداً: floor(65536 / 68) = 963 صفاً شاملاً صف العناوين.
 */
const XML_EXPANSION_BUDGET = 65_536;
const RESERVED_DATA_GRID_POSITIONS = 502 * PACKAGE_IMPORT_TEMPLATE_HEADERS.length;
export const PACKAGE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS = Math.floor(XML_EXPANSION_BUDGET / 68);

/** أقصى عدد خدمات مفتوحة يتسع له القالب بلا قصّ: صف العناوين يستهلك صفاً من سقف المرجع. */
export const PACKAGE_IMPORT_TEMPLATE_MAX_SERVICES = PACKAGE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS - 1;

/** سبب رفض القالب: سقف الصفوف أو سقف المواضع؛ الرسالة واحدة للمستخدم في الحالين. */
export type PackageImportTemplateRefusal = 'REFERENCE_ROWS' | 'REFERENCE_POSITIONS';

/** نتيجة فحص سعة القالب: مقبول، أو سبب الرفض المسمّى. */
export type PackageImportTemplateCapacity =
  { readonly ok: true } | { readonly ok: false; readonly reason: PackageImportTemplateRefusal };

/** رفض تنزيل مسمّى، يحوّله HTTP إلى IMPORT_TEMPLATE_EXCEEDS_LIMITS (422). */
export class PackageImportTemplateError extends Error {
  /**
   * يحتفظ بالرمز المسمّى للرفض.
   *
   * @param code رمز رفض القالب الوحيد
   */
  constructor(readonly code: 'IMPORT_TEMPLATE_EXCEEDS_LIMITS') {
    super(code);
    this.name = 'PackageImportTemplateError';
  }
}

/**
 * بيفحص سعة ورقة الخدمات قبل بناء المصنف: عدد الخدمات المفتوحة غير محدود، فالقالب يرفض التنزيل
 * برفض مسمّى لما المساحة تتجاوز سقف الحارس بدل ما يطلع ملف بيترفض عند الرفع أو يقصّ خدمات بصمت.
 * الشرطان: صفوف المرجع (العناوين + الخدمات) ضمن سقف الحارس، ومواضع المرجع مع شبكة البيانات المحجوزة
 * ضمن ميزانية التوسع.
 *
 * @param serviceCount عدد الخدمات المفتوحة في النشاط
 * @returns مقبول، أو سبب الرفض المسمّى
 */
export function packageImportTemplateCapacity(serviceCount: number): PackageImportTemplateCapacity {
  const rows = 1 + serviceCount;
  if (rows > PACKAGE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS)
    return { ok: false, reason: 'REFERENCE_ROWS' };
  const positions = RESERVED_DATA_GRID_POSITIONS + rows * PACKAGE_IMPORT_TEMPLATE_REFERENCE_COLUMNS;
  if (positions > XML_EXPANSION_BUDGET) return { ok: false, reason: 'REFERENCE_POSITIONS' };
  return { ok: true };
}
