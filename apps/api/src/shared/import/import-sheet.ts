// محرك جداول الاستيراد العام: عناوين، حدود الصفوف، وتحويل الخلايا — بلا أي معنى تجاري (ADR-0034).
// كل مستورد كيان (موظفون، خدمات، عملاء، باقات) يعيد استخدامه ويضيف قواعده في domain الخاص بموديوله.

/** قيمة خلية كما يقرأها xlsx: نصوص وأرقام ومنطقية أو فراغ؛ لا كائنات. */
export type ImportCell = string | number | boolean | null;
/** مصفوفة الصفوف كما تخرج من الورقة الأولى. */
export type ImportMatrix = readonly (readonly ImportCell[])[] & {
  readonly sourceRows?: readonly number[];
};

// علامة خلية تعذّرت قراءتها (خطأ Excel أو كائن غير مدعوم). لا يمكن أن تظهر كنص مستخدم لأن Excel لا يسمح بمحرف NUL،
// فتبقى خلية غير فارغة في فحص العناوين والصفوف وتُرفض في validator برمزها المسمّى.
export const INVALID_CELL = '\u0000import-invalid-cell\u0000';

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
 * @param maxRows الحد الذي يحدده مستورد الكيان
 * @returns الصفوف مع أرقامها أو سبب رفض الورقة
 */
export function readSheet(
  matrix: ImportMatrix,
  expected: readonly string[],
  maxRows: number,
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
    rows.push({ row: matrix.sourceRows?.[index + 1] ?? index + 2, cells });
    if (rows.length > maxRows) return 'IMPORT_ROW_LIMIT_EXCEEDED';
  }
  if (rows.length === 0) return 'IMPORT_HEADER_INVALID';
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
