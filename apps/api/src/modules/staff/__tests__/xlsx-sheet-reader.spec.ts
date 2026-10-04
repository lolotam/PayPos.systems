import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { INVALID_CELL, readSheet } from '../../../shared/import/import-sheet.ts';
import { EMPLOYEE_IMPORT_HEADERS } from '../domain/employee-import.ts';
import { readWorkbookMatrix } from '../persistence/xlsx-sheet-reader.ts';

const HEADERS = [...EMPLOYEE_IMPORT_HEADERS];

async function matrixOf(fill: (sheet: ExcelJS.Worksheet) => void) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('employees');
  HEADERS.forEach((header, index) => {
    sheet.getCell(1, index + 1).value = header;
  });
  fill(sheet);
  return readWorkbookMatrix(new Uint8Array(await workbook.xlsx.writeBuffer()));
}

describe('readWorkbookMatrix', () => {
  it('reads formulas by their cached result and joins rich text', async () => {
    const matrix = await matrixOf((sheet) => {
      sheet.getCell(2, 1).value = { formula: 'UPPER("synthetic")', result: 'synthetic' };
      sheet.getCell(3, 1).value = { richText: [{ text: 'Synthetic' }, { text: ' employee' }] };
    });
    expect(matrix[1]?.[0]).toBe('synthetic');
    expect(matrix[2]?.[0]).toBe('Synthetic employee');
  });

  it('marks an Excel error cell instead of reading it as text', async () => {
    const matrix = await matrixOf((sheet) => {
      sheet.getCell(2, 1).value = { error: '#DIV/0!' };
    });
    expect(matrix[1]?.[0]).toBe(INVALID_CELL);
  });

  it('keeps an Excel date as ISO when formatted and as a serial number otherwise', async () => {
    const matrix = await matrixOf((sheet) => {
      sheet.getCell(2, 4).value = new Date(Date.UTC(2026, 0, 1));
      sheet.getCell(3, 4).value = 45000;
    });
    expect(matrix[1]?.[3]).toBe('2026-01-01');
    expect(matrix[2]?.[3]).toBe(45000);
  });

  it('skips completely empty rows', async () => {
    const matrix = await matrixOf((sheet) => {
      sheet.getCell(2, 1).value = 'first';
      sheet.getCell(5, 1).value = 'second';
    });
    const result = readSheet(matrix, HEADERS);
    expect(typeof result === 'string' ? result : result.rows.map((row) => row.row)).toEqual([2, 5]);
  });

  it('refuses an extra non-empty header column', async () => {
    const matrix = await matrixOf((sheet) => {
      sheet.getCell(1, HEADERS.length + 1).value = 'notes';
    });
    expect(readSheet(matrix, HEADERS)).toBe('IMPORT_HEADER_INVALID');
  });
});
