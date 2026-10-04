import ExcelJS from 'exceljs';

import { INVALID_CELL, type ImportCell, type ImportMatrix } from '../../../shared/import/import-sheet.ts';

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
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) return [];
  // العرض هو آخر خلية غير فارغة في صف العناوين؛ الأعمدة الزائدة غير الفارغة يرفضها فحص العناوين.
  const header = sheet.getRow(1);
  let width = 0;
  header.eachCell({ includeEmpty: false }, (_cell, column) => {
    width = Math.max(width, column);
  });
  const matrix: ImportCell[][] = [];
  for (let index = 1; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const values: ImportCell[] = [];
    for (let column = 1; column <= width; column += 1) values.push(cellValue(row.getCell(column).value));
    matrix.push(values);
  }
  return matrix;
}
