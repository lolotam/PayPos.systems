import ExcelJS from 'exceljs';

import { INVALID_CELL, type ImportCell, type ImportMatrix } from './import-sheet.ts';
import { guardXlsxZip } from './xlsx-zip-guard.ts';

/** حدود تقنية يحددها المستورد؛ لا تحمل قواعد أي كيان تجاري. */
export interface WorkbookBounds {
  readonly maxBytes: number;
  readonly maxDataRows: number;
  readonly maxColumns: number;
  readonly maxWorksheets: number;
}

/** رفض تقني آمن للمصنف؛ لا يحمل محتوى خلايا أو سبب المزود الأصلي. */
export class ImportWorkbookError extends Error {
  /** يثبت رمز الرفض المحدود دون تفاصيل الملف.
   *
   * @param code سبب الرفض الآمن
   */
  constructor(readonly code: 'IMPORT_FILE_CONTENT_INVALID' | 'IMPORT_ROW_LIMIT_EXCEEDED') {
    super(code);
    this.name = 'ImportWorkbookError';
  }
}

// الصيغ تُقرأ من نتيجتها المخزنة، والنص المنسّق يُدمج، والخلايا المعطوبة تُعلَّم INVALID_CELL ولا تُفسَّر كنص
// (ADR-0034: القراءة على السيرفر فقط، و validator يرفض العلامة برمز IMPORT_CELL_INVALID).
function cellValue(value: ExcelJS.CellValue): ImportCell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText))
      return value.richText.map((run) => run.text).join('');
    if ('formula' in value || 'sharedFormula' in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      return cellValue(result ?? null);
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return INVALID_CELL;
  }
  return null;
}

/** قارئ الورقة المقروء بقيمه وتنسيقاته المحاذاة: ناتج الاختياري الجديد للقالب والمعاينة (072 P-1). */
export interface WorkbookSheetResult {
  readonly matrix: ImportMatrix;
  /** تنسيقات الأرقام بنفس إحداثيات المصفوفة؛ الخانة بلا تنسيق هي undefined. */
  readonly formats: readonly (readonly (string | undefined)[])[];
}

/**
 * بيقرا بايتات `.xlsx` كقيم وتنسيقات من ورقة واحدة بحماية القارئ نفسه (P-1):
 * نفس التمريرة المحمية الواحدة بتطلّع القيم ومصفوفة التنسيقات المحاذاة،
 * و`readWorkbookMatrix` هو نفسه النتيجة دي بتنسيقاتها مسقوطة.
 *
 * @param bytes  محتوى المصنف الموثّق
 * @param bounds حدود حجم المصنف وصفوف البيانات والأعمدة والأوراق الخاصة بالكيان
 * @returns القيم مع التنسيقات المحاذاة
 */
export async function readWorkbookSheet(
  bytes: Uint8Array,
  bounds: WorkbookBounds,
): Promise<WorkbookSheetResult> {
  if (bytes.byteLength > bounds.maxBytes)
    throw new ImportWorkbookError('IMPORT_FILE_CONTENT_INVALID');
  try {
    // هامش عمودين يحفظ أخطاء الأعمدة غير المعنونة؛ أربع أوراق تكفي القالب وورقتين إضافيتين بلا تضخيم.
    guardXlsxZip(Buffer.from(bytes), {
      maxRows: bounds.maxDataRows + 2,
      maxColumns: bounds.maxColumns,
      maxWorksheets: bounds.maxWorksheets,
    });
    return await loadSheet(bytes, bounds);
  } catch (error) {
    if (error instanceof ImportWorkbookError) throw error;
    if (error instanceof Error && error.message === 'IMPORT_ROW_LIMIT_EXCEEDED')
      throw new ImportWorkbookError('IMPORT_ROW_LIMIT_EXCEEDED');
    throw new ImportWorkbookError('IMPORT_FILE_CONTENT_INVALID');
  }
}

/**
 * بيحوّل بايتات `.xlsx` إلى مصفوفة الخلايا من الورقة الأولى فقط، دون أي قاعدة تجارية.
 *
 * @param bytes محتوى المصنف الموثّق
 * @param bounds حدود حجم المصنف وصفوف البيانات والأعمدة والأوراق الخاصة بالكيان
 * @returns صفوف الورقة الأولى كخلايا أولية
 */
export async function readWorkbookMatrix(
  bytes: Uint8Array,
  bounds: WorkbookBounds,
): Promise<ImportMatrix> {
  return (await readWorkbookSheet(bytes, bounds)).matrix;
}

async function loadSheet(bytes: Uint8Array, bounds: WorkbookBounds): Promise<WorkbookSheetResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new ImportWorkbookError('IMPORT_FILE_CONTENT_INVALID');
  // العرض هو آخر خلية غير فارغة في صف العناوين؛ الأعمدة الزائدة غير الفارغة يرفضها فحص العناوين.
  const header = sheet.getRow(1);
  let width = 0;
  header.eachCell({ includeEmpty: false }, (cell, column) => {
    const value = cellValue(cell.value);
    if (value !== null && String(value).trim() !== '') width = Math.max(width, column);
  });
  const matrix: ImportCell[][] = [];
  const formats: (string | undefined)[][] = [];
  const headerValues: ImportCell[] = Array.from({ length: width }, (_, column) =>
    cellValue(header.getCell(column + 1).value),
  );
  matrix.push(headerValues);
  formats.push(
    Array.from({ length: width }, (_, column) => header.getCell(column + 1).numFmt ?? undefined),
  );
  const sourceRows = [1];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    // آخر عمود فعلي في الصف هو الحد: خلايا بعد آخر عنوان تبقى ظاهرة للمُستورد
    // ليرفضها IMPORT_COLUMN_UNEXPECTED بدل ما تضيع كصف فارغ أو صف صالح (072 FR-003).
    let lastColumn = 0;
    row.eachCell({ includeEmpty: false }, (_cell, column) => {
      lastColumn = Math.max(lastColumn, column);
    });
    const values: ImportCell[] = Array.from({ length: lastColumn }, () => null);
    const rowFormats: (string | undefined)[] = Array.from({ length: lastColumn }, () => undefined);
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      values[column - 1] = cellValue(cell.value);
      rowFormats[column - 1] = cell.numFmt ?? undefined;
    });
    if (values.every((value) => value === null || String(value).trim() === '')) return;
    if (matrix.length > bounds.maxDataRows)
      throw new ImportWorkbookError('IMPORT_ROW_LIMIT_EXCEEDED');
    matrix.push(values);
    formats.push(rowFormats);
    sourceRows.push(rowNumber);
  });
  return { matrix: Object.assign(matrix, { sourceRows }), formats };
}
