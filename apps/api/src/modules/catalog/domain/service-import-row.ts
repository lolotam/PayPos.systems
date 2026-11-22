import {
  parseServiceImportBooleanCell,
  parseServiceImportCategoryCell,
  parseServiceImportDurationCell,
  parseServiceImportNameCell,
  type ServiceImportCategoryResolver,
} from './service-import-cells.ts';
import { parseServiceImportCommissionCells } from './service-import-commission.ts';
import { parseServiceImportPriceCell, type ServiceImportTaggedCell } from './service-import-price-cell.ts';
import type { ServiceImportRowColumn, ServiceImportRowErrorCode } from './service-import.ts';
import {
  buildNormalizedRow,
  type ServiceImportNormalizedRow,
} from './service-import-normalized-row.ts';

export type { ServiceImportNormalizedRow } from './service-import-normalized-row.ts';
export type { ServiceImportRowColumn, ServiceImportRowErrorCode } from './service-import.ts';

/** خطأ صف واحد: رقم الصف الأصلي والعمود والرمز، وأكثر من رمز واحد لنفس الصف والعمود ممنوع. */
export interface ServiceImportRowIssue {
  readonly row: number;
  readonly column: ServiceImportRowColumn;
  readonly code: ServiceImportRowErrorCode;
}

/**
 * اسم الصف المطلق لكل صف اسمه الإنجليزي سليم، لتحمله إلى مقارنة PostgreSQL: التكرار داخل
 * الملف والوجود في النشاط كلهما يُحسمان بتعبير الطي الواحد في PostgreSQL فلا يبقى مفتاح
 * جافاسكربت يعارض قاعدة البيانات (FR-007، HIGH مراجعة 1186).
 */
export interface ServiceImportRowKey {
  readonly row: number;
  /** الاسم المطلق كما ورد في الخلية؛ المقارنة كلها داخل PostgreSQL على الطرفين (A-12). */
  readonly name: string;
}

/** مدخل المماسّر الثابت هنا (A-12): الخلايا الموسومة بأرقام الصفوف الأصلية بعد إزالة الفارغ. */
export interface ServiceImportSheetInput {
  readonly headers: readonly string[];
  readonly rows: readonly {
    readonly row: number;
    readonly cells: readonly ServiceImportTaggedCell[];
  }[];
}

/** نتيجة المماسّر: الصفوف المطبّعة ومفاتيح الأسماء والأخطاء، كل واحدة بترتيب الورقة (A-7/A-11). */
export interface ServiceImportMapping {
  readonly rows: readonly ServiceImportNormalizedRow[];
  readonly keys: readonly ServiceImportRowKey[];
  readonly errors: readonly ServiceImportRowIssue[];
}

// خلية بلا محتوى حقيقي: فراغ أو نص مسافات فقط؛ أي حاجة تانية بعد آخر عنوان بيانات غير متوقعة.
function cellHasData(cell: ServiceImportTaggedCell): boolean {
  if (cell === null) return false;
  return cell.kind !== 'text' || cell.text.trim() !== '';
}

function commissionRefusalCode(
  reason: 'CELL_INVALID' | 'RULE_INVALID' | 'VALUE_INVALID' | 'REQUIRED',
  column: 'commission_rule' | 'commission_value',
): ServiceImportRowErrorCode {
  if (reason === 'CELL_INVALID') return 'IMPORT_CELL_INVALID';
  if (reason === 'RULE_INVALID') return 'IMPORT_COMMISSION_RULE_INVALID';
  if (reason === 'REQUIRED') return 'IMPORT_REQUIRED_CELL';
  return column === 'commission_value'
    ? 'IMPORT_COMMISSION_VALUE_INVALID'
    : 'IMPORT_COMMISSION_RULE_INVALID';
}

/**
 * بيحوّل ورقة الخدمات الموسومة لصفوف مطبّعة وأسماء وأخطاء مسمّاة (D-8): كل عمود بيتفحص لوحده،
 * وأخطاء الصف الواحد بترجع بترتيب أعمدة الورقة نفسها و`unexpected_column` آخرها، ورمز واحد لكل
 * صف وعمود. اسم كل صف اسمه سليم يُحمل مطلقاً حتى لو عمود تاني غلط أو الصف مكرر، فتقارن الأسماء
 * داخل PostgreSQL وحدها: التكرار داخل الملف والوجود في النشاط بتعبير طي واحد (FR-007، A-12)،
 * ومطابقة التصنيف بمحلّل معطى مسبقاً يقرره المستهلك من قاعدة البيانات، مش بمسح جافاسكربت هنا (A-11).
 *
 * @param sheet           عناوين الورقة المشذبة وصفوفها الموسومة بأرقامها الأصلية
 * @param resolveCategory محلّل نصّ البحث إلى التصنيف المفتوح المحلول أو `null`
 * @returns الصفوف والأسماء والأخطاء، كل قائمة بترتيب الورقة
 */
export function mapServiceImportRows(
  sheet: ServiceImportSheetInput,
  resolveCategory: ServiceImportCategoryResolver,
): ServiceImportMapping {
  const positions = new Map(sheet.headers.map((header, index) => [header, index]));
  const layout: SheetLayout = {
    headers: sheet.headers,
    positions,
    headerCount: sheet.headers.length,
  };
  const errors: ServiceImportRowIssue[] = [];
  const rows: ServiceImportNormalizedRow[] = [];
  const keys: ServiceImportRowKey[] = [];
  for (const source of sheet.rows) {
    const outcome = mapSheetRow(source, layout, resolveCategory, errors);
    if (outcome.name !== null) keys.push({ row: source.row, name: outcome.name });
    if (outcome.row !== null) rows.push(outcome.row);
  }
  return { rows, keys, errors };
}

/** تخطيط الورقة: العناوين نفسها وموضع كل عنوان وعدد الأعمدة المعلنة، ثابت على مستوى الورقة كلها. */
interface SheetLayout {
  readonly headers: readonly string[];
  readonly positions: ReadonlyMap<string, number>;
  readonly headerCount: number;
}

/** نتيجة صف واحد: الصف المطبّع أو فراغه، واسمه المطلق إن كان سليماً؛ أخطاؤه اتكتبت في القائمة. */
interface SheetRowOutcome {
  readonly row: ServiceImportNormalizedRow | null;
  readonly name: string | null;
}

// بيتحول صف واحد: التوسيم فوق آخر عنوان، ثم كل عمود بيتجمع خطأه، ثم الإخراج بترتيب أعمدة الورقة
// و`unexpected_column` آخرها، والفحص النهائي للصف الخالي من الأخطاء فقط (D-8).
function mapSheetRow(
  source: { readonly row: number; readonly cells: readonly ServiceImportTaggedCell[] },
  layout: SheetLayout,
  resolveCategory: ServiceImportCategoryResolver,
  errors: ServiceImportRowIssue[],
): SheetRowOutcome {
  const at = (header: string): ServiceImportTaggedCell =>
    source.cells[layout.positions.get(header) ?? -1] ?? null;
  const perColumn = new Map<ServiceImportRowColumn, ServiceImportRowErrorCode>();
  const collect = (column: ServiceImportRowColumn, code: ServiceImportRowErrorCode): void => {
    if (!perColumn.has(column)) perColumn.set(column, code);
  };
  if (source.cells.slice(layout.headerCount).some(cellHasData))
    collect('unexpected_column', 'IMPORT_COLUMN_UNEXPECTED');
  const cells = convertRowCells(at, resolveCategory, collect);
  for (const header of layout.headers) {
    const column = header as ServiceImportRowColumn;
    const code = perColumn.get(column);
    if (code !== undefined) errors.push({ row: source.row, column, code });
  }
  const unexpected = perColumn.get('unexpected_column');
  if (unexpected !== undefined)
    errors.push({ row: source.row, column: 'unexpected_column', code: unexpected });
  const name = cells.nameEn.ok ? cells.nameEn.value : null;
  if (perColumn.size > 0) return { row: null, name };
  // باب التضييق النوعي: وصلنا بكل الحقول مقبولة، فالسطر ده حرفياً نفس معنى perColumn فاضية.
  if (
    !(
      cells.nameEn.ok &&
      cells.price.ok &&
      cells.duration.ok &&
      cells.category.ok &&
      cells.commission.ok &&
      cells.counts.ok
    )
  )
    return { row: null, name };
  const final = buildNormalizedRow(source.row, {
    nameEn: cells.nameEn.value ?? '',
    nameAr: cells.nameAr.ok ? cells.nameAr.value : null,
    price: cells.price.price,
    duration: cells.duration.value,
    category: cells.category.value,
    rule: cells.commission.rule,
    defaulted: cells.commission.defaulted,
    counts: cells.counts.value,
  });
  if (final.ok) return { row: final.row, name };
  errors.push({ row: source.row, column: final.column, code: final.code });
  return { row: null, name };
}

/** نتائج تحويل خلايا الصف الثمانية كما خرجت من محوّلاتها، وأخطاؤها متجمعة لكل عمود. */
interface ConvertedCells {
  readonly nameEn: ReturnType<typeof parseServiceImportNameCell>;
  readonly nameAr: ReturnType<typeof parseServiceImportNameCell>;
  readonly price: ReturnType<typeof parseServiceImportPriceCell>;
  readonly duration: ReturnType<typeof parseServiceImportDurationCell>;
  readonly category: ReturnType<typeof parseServiceImportCategoryCell>;
  readonly commission: ReturnType<typeof parseServiceImportCommissionCells>;
  readonly counts: ReturnType<typeof parseServiceImportBooleanCell>;
}

// كل خلية بتتحول لوحدها وخطأها بيتجمع على عموده بأول سبب يفوز، فالصف الواحد بيقدّم كل أعمدته الغلط (D-8).
function convertRowCells(
  at: (header: string) => ServiceImportTaggedCell,
  resolveCategory: ServiceImportCategoryResolver,
  collect: (column: ServiceImportRowColumn, code: ServiceImportRowErrorCode) => void,
): ConvertedCells {
  const nameEn = parseServiceImportNameCell(at('name_en'), true);
  if (!nameEn.ok) collect('name_en', nameEn.code);
  const nameAr = parseServiceImportNameCell(at('name_ar'), false);
  if (!nameAr.ok) collect('name_ar', nameAr.code);
  const price = parseServiceImportPriceCell(at('price'));
  if (!price.ok) collect('price', price.code);
  const duration = parseServiceImportDurationCell(at('duration_minutes'));
  if (!duration.ok) collect('duration_minutes', duration.code);
  const category = parseServiceImportCategoryCell(at('category'), resolveCategory);
  if (!category.ok) collect('category', category.code);
  const commission = parseServiceImportCommissionCells(
    at('commission_rule'),
    at('commission_value'),
  );
  if (!commission.ok) {
    for (const refusal of commission.errors)
      collect(refusal.column, commissionRefusalCode(refusal.reason, refusal.column));
  }
  const counts = parseServiceImportBooleanCell(at('counts_toward_threshold'));
  if (!counts.ok) collect('counts_toward_threshold', counts.code);
  return { nameEn, nameAr, price, duration, category, commission, counts };
}
