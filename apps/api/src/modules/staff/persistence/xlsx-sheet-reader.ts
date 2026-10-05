import ExcelJS from 'exceljs';

import {
  INVALID_CELL,
  type ImportCell,
  type ImportMatrix,
} from '../../../shared/import/import-sheet.ts';
import { guardXlsxZip } from '../../../shared/import/xlsx-zip-guard.ts';
import {
  EMPLOYEE_IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  EMPLOYEE_IMPORT_HEADERS,
  EmployeeImportError,
} from '../domain/employee-import.ts';

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

/**
 * بيحوّل بايتات `.xlsx` إلى مصفوفة الخلايا من الورقة الأولى فقط، دون أي قاعدة تجارية.
 *
 * @param bytes محتوى المصنف الموثّق
 * @returns صفوف الورقة الأولى كخلايا أولية
 */
export async function readWorkbookMatrix(bytes: Uint8Array): Promise<ImportMatrix> {
  if (bytes.byteLength > EMPLOYEE_IMPORT_MAX_BYTES)
    throw new EmployeeImportError('IMPORT_FILE_CONTENT_INVALID');
  try {
    // هامش عمودين يحفظ أخطاء الأعمدة غير المعنونة؛ أربع أوراق تكفي القالب وورقتين إضافيتين بلا تضخيم.
    guardXlsxZip(Buffer.from(bytes), {
      maxRows: IMPORT_MAX_ROWS + 2,
      maxColumns: EMPLOYEE_IMPORT_HEADERS.length + 2,
      maxWorksheets: 4,
    });
    return await loadMatrix(bytes);
  } catch (error) {
    if (error instanceof EmployeeImportError) throw error;
    throw new EmployeeImportError('IMPORT_FILE_CONTENT_INVALID');
  }
}

async function loadMatrix(bytes: Uint8Array): Promise<ImportMatrix> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new EmployeeImportError('IMPORT_FILE_CONTENT_INVALID');
  // العرض هو آخر خلية غير فارغة في صف العناوين؛ الأعمدة الزائدة غير الفارغة يرفضها فحص العناوين.
  const header = sheet.getRow(1);
  let width = 0;
  header.eachCell({ includeEmpty: false }, (cell, column) => {
    const value = cellValue(cell.value);
    if (value !== null && String(value).trim() !== '') width = Math.max(width, column);
  });
  const matrix: ImportCell[][] = [
    Array.from({ length: width }, (_, column) => cellValue(header.getCell(column + 1).value)),
  ];
  const sourceRows = [1];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: ImportCell[] = Array.from({ length: width }, () => null);
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      values[column - 1] = cellValue(cell.value);
    });
    if (values.every((value) => value === null || String(value).trim() === '')) return;
    if (matrix.length > IMPORT_MAX_ROWS) throw new EmployeeImportError('IMPORT_ROW_LIMIT_EXCEEDED');
    matrix.push(values);
    sourceRows.push(rowNumber);
  });
  return Object.assign(matrix, { sourceRows });
}
