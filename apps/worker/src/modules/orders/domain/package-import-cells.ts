/** قيمة خلية خام بلا اعتماد على محرك القراءة. */
export type ImportCell = string | number | boolean | null;
/** ورقة بقيم أولية؛ الشكل مستقل عن المحول التقني. */
export interface ReadSheetResult {
  readonly headers: readonly string[];
  readonly rows: readonly { readonly row: number; readonly cells: readonly ImportCell[] }[];
}
/** العلامة المستحيلة في نص Excel التي يرسلها المحول للخلية المعطوبة. */
export const INVALID_CELL = '\u0000import-invalid-cell\u0000';
/**
 * ينظف النص ويرفض علامة الخلية المعطوبة قبل قواعد الحقول.
 *
 * @param cell الخلية الخام
 * @returns النص المنظف أو null
 */
export function cellText(cell: ImportCell): string | null {
  if (cell === null || cell === INVALID_CELL) return null;
  const value = String(cell).trim();
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

/**
 * يقبل تاريخ الاستيراد كرقم Excel أو نص ISO مطابق لليوم الحقيقي.
 *
 * @param cell خلية التاريخ
 * @returns التاريخ الموحد أو null
 */
export function cellDate(cell: ImportCell): string | null {
  if (typeof cell === 'number') return excelSerialToIsoDate(cell);
  const value = cellText(cell);
  return value === null ? null : isoDateFromText(value);
}
