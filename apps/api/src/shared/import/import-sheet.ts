// محرك جداول الاستيراد العام: عناوين، حدود الصفوف، وتحويل الخلايا — بلا أي معنى تجاري (ADR-0032).
// كل مستورد كيان (موظفون، خدمات، عملاء، باقات) يعيد استخدامه ويضيف قواعده في domain الخاص بموديوله.

/** قيمة خلية كما يقرأها xlsx: نصوص وأرقام ومنطقية أو فراغ؛ لا كائنات. */
export type ImportCell = string | number | boolean | null;
/** مصفوفة الصفوف كما تخرج من الورقة الأولى. */
export type ImportMatrix = readonly (readonly ImportCell[])[];

// علامة خلية تعذّرت قراءتها (خطأ Excel أو كائن غير مدعوم). لا يمكن أن تظهر كنص مستخدم لأن Excel لا يسمح بمحرف NUL،
// فتبقى خلية غير فارغة في فحص العناوين والصفوف وتُرفض في validator برمزها المسمّى.
export const INVALID_CELL = '\u0000import-invalid-cell\u0000';

/** الحد الأقصى لصفوف البيانات في أي استيراد (PR 11 rule 2). */
export const IMPORT_MAX_ROWS = 500;

export type SheetIssue = 'IMPORT_HEADER_INVALID' | 'IMPORT_ROW_LIMIT_EXCEEDED';

export interface ImportDataRow {
  readonly row: number;
  readonly cells: readonly ImportCell[];
}

export interface ReadSheetResult {
  readonly headers: readonly string[];
  readonly rows: readonly ImportDataRow[];
}

const text = (cell: ImportCell): string => (cell === null ? '' : String(cell).trim());

/**
 * بيقرا الورقة الأولى: يتحقق من مجموعة العناوين المطلوبة بالضبط ويرقّم صفوف البيانات الحقيقية.
 * الأعمدة الناقصة أو الزائدة أو المكررة ترفض الورقة كلها، والصفوف الفارغة تُتجاهل.
 *
 * @param matrix صفوف الورقة كخلايا أولية
 * @param expected أسماء الأعمدة المرجعية المطلوبة
 * @returns الصفوف مع أرقامها أو سبب رفض الورقة
 */
export function readSheet(
  matrix: ImportMatrix,
  expected: readonly string[],
): ReadSheetResult | SheetIssue {
  const headerRow = matrix[0];
  if (headerRow === undefined) return 'IMPORT_HEADER_INVALID';
  const headers = headerRow.map(text);
  const want = [...expected].sort();
  const have = [...headers].sort();
  if (
    headers.length !== expected.length ||
    new Set(headers).size !== headers.length ||
    have.length !== want.length ||
    have.some((name, index) => name !== want[index])
  )
    return 'IMPORT_HEADER_INVALID';
  const rows: ImportDataRow[] = [];
  for (const [index, cells] of matrix.slice(1).entries()) {
    if (cells.every((cell) => text(cell) === '')) continue;
    rows.push({ row: index + 2, cells });
  }
  if (rows.length > IMPORT_MAX_ROWS) return 'IMPORT_ROW_LIMIT_EXCEEDED';
  return { headers, rows };
}

/**
 * بيرجّع نص الخلية منظفاً أو null لو فاضية.
 *
 * @param cell خلية أولية
 * @returns النص أو null
 */
export function cellText(cell: ImportCell): string | null {
  if (cell === INVALID_CELL) return null;
  const value = text(cell);
  return value === '' ? null : value;
}

// Excel بيعدّ الأيام من 1899-12-30، وفيه يوم كبيس وهمي قبل 1900-03-01 فنعوّضه.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/**
 * بيحوّل رقم Excel التسلسلي إلى تاريخ ميلادي ISO — الأرقام الكسرية (وقت) تُرفض لأن الاستيراد تواريخ فقط.
 *
 * @param serial رقم الخلية التسلسلي
 * @returns تاريخ YYYY-MM-DD أو null لو غير صالح
 */
export function excelSerialToIsoDate(serial: number): string | null {
  if (!Number.isFinite(serial) || !Number.isInteger(serial) || serial < 1 || serial > 2_958_465)
    return null;
  const adjusted = serial < 60 ? serial + 1 : serial;
  const date = new Date(EXCEL_EPOCH_MS + adjusted * DAY_MS);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * بيتحقق إن النص تاريخ ميلادي حقيقي بصيغة YYYY-MM-DD (يرفض 2026-02-30).
 *
 * @param value نص الخلية
 * @returns التاريخ كما هو أو null
 */
export function isoDateFromText(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toISOString().slice(0, 10) === value ? value : null;
}
