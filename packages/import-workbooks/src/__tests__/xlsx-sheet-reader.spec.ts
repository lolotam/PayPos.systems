import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { INVALID_CELL, readSheet, readWorkbookMatrix } from '../index.ts';

const bounds = { maxBytes: 2 * 1024 * 1024, maxDataRows: 500, maxColumns: 68, maxWorksheets: 4 };
async function workbook(fill: (sheet: ExcelJS.Worksheet, book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('data');
  sheet.addRow(['first', 'second']);
  fill(sheet, book);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

it('preserves cached formulas, rich text, invalid cells and physical source rows', async () => {
  const bytes = await workbook((sheet) => {
    sheet.getCell(2, 1).value = { formula: '1+1', result: 2 };
    sheet.getCell(2, 2).value = { richText: [{ text: 'one' }, { text: 'two' }] };
    sheet.getCell(4, 1).value = { error: '#DIV/0!' };
  });
  const matrix = await readWorkbookMatrix(bytes, bounds);
  expect(matrix[1]).toEqual([2, 'onetwo']);
  expect(matrix[2]?.[0]).toBe(INVALID_CELL);
  expect(matrix.sourceRows).toEqual([1, 2, 4]);
  expect(readSheet(matrix, ['second', 'first'], 500)).toMatchObject({
    headers: ['first', 'second'],
    rows: [{ row: 2 }, { row: 4 }],
  });
});

it('rejects malformed bytes and byte overflow before workbook loading', async () => {
  await expect(readWorkbookMatrix(new Uint8Array([1, 2, 3]), bounds)).rejects.toMatchObject({
    code: 'IMPORT_FILE_CONTENT_INVALID',
  });
  await expect(
    readWorkbookMatrix(new Uint8Array(bounds.maxBytes + 1), bounds),
  ).rejects.toMatchObject({ code: 'IMPORT_FILE_CONTENT_INVALID' });
});

it('retains all 500 bounded data rows and refuses row 501', async () => {
  const bytes = await workbook((sheet) => {
    for (let index = 0; index < 500; index++) sheet.addRow([index, 'value']);
  });
  expect((await readWorkbookMatrix(bytes, bounds)).length).toBe(501);
  const tooMany = await workbook((sheet) => {
    for (let index = 0; index < 501; index++) sheet.addRow([index, 'value']);
  });
  await expect(readWorkbookMatrix(tooMany, bounds)).rejects.toMatchObject({
    code: 'IMPORT_ROW_LIMIT_EXCEEDED',
  });
});

it('refuses excessive worksheets and columns without weakening other callers bounds', async () => {
  const sheets = await workbook((_sheet, book) => {
    for (let index = 0; index < 4; index++) book.addWorksheet(`extra-${index}`);
  });
  await expect(readWorkbookMatrix(sheets, bounds)).rejects.toMatchObject({
    code: 'IMPORT_FILE_CONTENT_INVALID',
  });
  const columns = await workbook((sheet) => {
    sheet.getCell(2, 69).value = 'overflow';
  });
  await expect(readWorkbookMatrix(columns, bounds)).rejects.toMatchObject({
    code: 'IMPORT_FILE_CONTENT_INVALID',
  });
});
