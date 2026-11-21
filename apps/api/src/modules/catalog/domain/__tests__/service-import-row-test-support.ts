import {
  mapServiceImportRows,
  type ServiceImportNormalizedRow,
  type ServiceImportRowIssue,
} from '../service-import-row.ts';
import type { ServiceImportOpenCategory } from '../service-import-cells.ts';
import type { ServiceImportTaggedCell } from '../service-import-price-cell.ts';

/**
 * بيحول نص لخلية موسومة نصّية كما تخرج من خطوة التوسيم، وهو المدخل الأكثر استخداماً في اختبارات المماسّر.
 *
 * @param value نص الخلية كما ورد في المصنف
 * @returns خلية موسومة نصّية
 */
export const text = (value: string): ServiceImportTaggedCell => ({ kind: 'text', text: value });

/**
 * بيحول نصاً عشرياً لخلية رقمية موسومة بنصّها العشري، بلا تنسيق نسبة.
 *
 * @param value نص الرقم العشري كما يكتبه Number.toString
 * @returns خلية موسومة رقمية
 */
export const numeric = (value: string): ServiceImportTaggedCell => ({
  kind: 'numeric',
  text: value,
  percentFormat: false,
});

/**
 * بيحول قيمة منطقية لخلية موسومة منطقية كما تقرأها ExcelJS.
 *
 * @param value القيمة المنطقية للخلية
 * @returns خلية موسومة منطقية
 */
export const bool = (value: boolean): ServiceImportTaggedCell => ({ kind: 'boolean', value });

/**
 * بيحول نص عرض لخلية رقم غير ممثلة، للحالات اللي بتعدي حد الأرقام الخمسة عشر أو صيغة الأس.
 *
 * @param display نص العرض الآمن للخلية
 * @returns خلية موسومة رقم غير ممثل
 */
export const unrepresentable = (display: string): ServiceImportTaggedCell => ({
  kind: 'numeric-unrepresentable',
  display,
});

/**
 * بيصنع خلية خطأ إكسل كما تتركها خطوة التوسيم، ورفضها دايماً IMPORT_CELL_INVALID على عمودها.
 *
 * @returns خلية موسومة خطأ
 */
export const errorCell = (): ServiceImportTaggedCell => ({ kind: 'error' });

/** العناوين الثمانية بترتيبها المرجعي: الستة الإجبارية والعمودان الاختياريان. */
export const HEADERS = [
  'name_en',
  'name_ar',
  'price',
  'duration_minutes',
  'category',
  'commission_rule',
  'commission_value',
  'counts_toward_threshold',
];

/** هوية التصنيف المفتوح الوحيدة في اختبارات المماسّر، بالاسم الإنجليزي المخزّن المطابق. */
export const HAIR = '018f0000-0000-7000-8000-000000000001';

/** التصنيفات المفتوحة الافتراضية للنشاط في اختبارات المماسّر. */
export const OPEN_CATEGORIES: readonly ServiceImportOpenCategory[] = [
  { id: HAIR, name_en: 'Hair Care' },
];

/** خلايا صف واحد بالأسماء المرجعية، مع خانة extra للبيانات بعد آخر عنوان. */
export interface RowCells {
  readonly name_en?: ServiceImportTaggedCell;
  readonly name_ar?: ServiceImportTaggedCell;
  readonly price?: ServiceImportTaggedCell;
  readonly duration_minutes?: ServiceImportTaggedCell;
  readonly category?: ServiceImportTaggedCell;
  readonly commission_rule?: ServiceImportTaggedCell;
  readonly commission_value?: ServiceImportTaggedCell;
  readonly counts_toward_threshold?: ServiceImportTaggedCell;
  readonly extra?: readonly ServiceImportTaggedCell[];
}

/**
 * بيصنع صفاً سليماً افتراضياً باسم معين وأي تجاوزات، عشان كل اختبار يحدد غير الفروق فقط.
 *
 * @param nameEn    الاسم الإنجليزي للصف
 * @param overrides تجاوزات الخلايا على الافتراضي
 * @returns خلايا الصف الجاهزة للورقة
 */
export const goodRow = (nameEn = 'Hair Cut', overrides: RowCells = {}): RowCells => ({
  name_en: text(nameEn),
  price: text('12.5'),
  commission_rule: text('PCT'),
  commission_value: text('10'),
  counts_toward_threshold: text('yes'),
  ...overrides,
});

const sheetOf = (rows: readonly { row: number; cells: RowCells }[], headers: readonly string[]) => ({
  headers,
  rows: rows.map(({ row, cells }) => {
    const { extra, ...named } = cells;
    return {
      row,
      cells: (
        headers.map((header) => named[header as keyof typeof named] ?? null) as ServiceImportTaggedCell[]
      ).concat(extra ?? []),
    };
  }),
});

/**
 * بيمرر صفوف اختبار على المماسّر بالتصنيفات المفتوحة الافتراضية ورؤوس الورقة المعطاة.
 *
 * @param rows    الصفوف بأرقامها الأصلية وخلاياها بالأسماء المرجعية
 * @param headers عناوين الورقة، والافتراضي الترتيب المرجعي
 * @returns نتيجة المماسّر كما هي
 */
export const mapRows = (
  rows: readonly { row: number; cells: RowCells }[],
  headers: readonly string[] = HEADERS,
) => mapServiceImportRows(sheetOf(rows, headers), OPEN_CATEGORIES);

/**
 * نفس mapRows بتصنيفات مفتوحة مخصصة، لاختبار تصنيف مقفول مش ممرر أصلاً (FR-004).
 *
 * @param rows           الصفوف بأرقامها الأصلية وخلاياها
 * @param openCategories التصنيفات المفتوحة المعطاة
 * @param headers        عناوين الورقة، والافتراضي الترتيب المرجعي
 * @returns نتيجة المماسّر كما هي
 */
export const mapRowsWithCategories = (
  rows: readonly { row: number; cells: RowCells }[],
  openCategories: readonly ServiceImportOpenCategory[],
  headers: readonly string[] = HEADERS,
) => mapServiceImportRows(sheetOf(rows, headers), openCategories);

/**
 * بيصيغ أخطاء الصفوف نصاً `row:column:code` عشان مقارنة القوائم تكون واضحة في الفشل.
 *
 * @param errors أخطاء المماسّر
 * @returns نصوص الصياغة بترتيبها
 */
export const codes = (errors: readonly ServiceImportRowIssue[]) =>
  errors.map((error) => `${error.row}:${error.column}:${error.code}`);

/**
 * بيصنع الصف المطبّع المتوقع لصف سليم بالقواعد الافتراضية وأي تجاوزات، عشان المقارنة الكاملة تميّز كل حقل.
 *
 * @param row       رقم الصف الأصلي
 * @param nameEn    الاسم الإنجليزي المتوقع
 * @param overrides تجاوزات الحقول على الافتراضي
 * @returns الصف المطبّع المتوقع
 */
export const expectedRow = (
  row: number,
  nameEn: string,
  overrides: Partial<ServiceImportNormalizedRow> = {},
) => ({
  row,
  name_en: nameEn,
  name_ar: null,
  price: '12.500',
  duration_minutes: null,
  category_id: null,
  category_name_en: null,
  commission_rule: { kind: 'PCT', value: 1000 },
  commission_value: 1000,
  commission_rule_defaulted: false,
  counts_toward_threshold: true,
  ...overrides,
});
