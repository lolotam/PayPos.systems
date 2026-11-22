import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { INVALID_CELL, readSheet, readWorkbookMatrix, readWorkbookSheet } from '../index.ts';

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

it('returns aligned number formats from the same guarded pass and keeps the plain caller intact', async () => {
  const bytes = await workbook((sheet) => {
    sheet.getCell(2, 1).value = 12.5;
    sheet.getCell(2, 1).numFmt = '0.00%';
    sheet.getCell(2, 2).value = 3;
  });
  const plain = await readWorkbookMatrix(bytes, bounds);
  expect(plain[1]).toEqual([12.5, 3]);
  const result = await readWorkbookSheet(bytes, bounds);
  expect(result.matrix[1]).toEqual([12.5, 3]);
  expect(result.formats).toHaveLength(result.matrix.length);
  expect(result.formats[1]?.[0]).toBe('0.00%');
  expect(result.formats[1]?.[1]).toBeUndefined();
  expect(result.formats[0]).toEqual([undefined, undefined]);
  expect(result.matrix.sourceRows).toEqual([1, 2]);
});

it('keeps formats aligned across skipped blank rows and sparse columns', async () => {
  const bytes = await workbook((sheet) => {
    sheet.getCell(3, 1).value = 7;
    sheet.getCell(3, 1).numFmt = '#,##0';
    sheet.getCell(5, 2).value = 9;
  });
  const result = await readWorkbookSheet(bytes, bounds);
  expect(result.matrix.sourceRows).toEqual([1, 3, 5]);
  expect(result.formats[1]?.[0]).toBe('#,##0');
  expect(result.formats[2]?.[1]).toBeUndefined();
});

it('keeps cells and formats beyond the last header so importers can reject them', async () => {
  const bytes = await workbook((sheet) => {
    sheet.getCell(2, 3).value = 12.5;
    sheet.getCell(2, 3).numFmt = '0.000';
    sheet.getCell(3, 4).value = { error: '#REF!' };
  });
  const result = await readWorkbookSheet(bytes, bounds);
  expect(result.matrix.sourceRows).toEqual([1, 2, 3]);
  expect(result.matrix[1]).toEqual([null, null, 12.5]);
  expect(result.formats[1]?.[2]).toBe('0.000');
  expect(result.matrix[2]?.[3]).toBe(INVALID_CELL);
});

it('pads short rows to the header width with nulls while keeping overflow columns', async () => {
  const bytes = await workbook((sheet) => {
    sheet.getCell(2, 1).value = 'only first';
    sheet.getCell(3, 1).value = 'a';
    sheet.getCell(3, 3).value = 'overflow';
  });
  const legacy = await readWorkbookMatrix(bytes, bounds);
  // المتصل القديم يقرأ حقل الخانة الأخيرة فارغاً كـ null لا undefined، كما وعد القارئ القديم.
  expect(legacy[1]).toEqual(['only first', null]);
  expect(legacy[2]).toEqual(['a', null, 'overflow']);
  const result = await readWorkbookSheet(bytes, bounds);
  expect(result.matrix[1]).toEqual(['only first', null]);
  expect(result.formats[1]).toEqual([undefined, undefined]);
});
