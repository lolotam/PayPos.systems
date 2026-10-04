import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { INVALID_CELL, readSheet } from '../../../shared/import/import-sheet.ts';
import { EMPLOYEE_IMPORT_HEADERS } from '../domain/employee-import.ts';
import { readWorkbookMatrix } from '../persistence/xlsx-sheet-reader.ts';
import { validateEmployeeImport } from '../use-cases/preview-employee-import/employee-import.validator.ts';
import { EmployeeImportError, EMPLOYEE_IMPORT_MAX_BYTES } from '../domain/employee-import.ts';

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
    const result = readSheet(matrix, HEADERS, 500);
    expect(typeof result === 'string' ? result : result.rows.map((row) => row.row)).toEqual([2, 5]);
  });

  it('refuses an extra non-empty header column', async () => {
    const matrix = await matrixOf((sheet) => {
      sheet.getCell(1, HEADERS.length + 1).value = 'notes';
    });
    expect(readSheet(matrix, HEADERS, 500)).toBe('IMPORT_HEADER_INVALID');
  });
});

describe('workbook hardening', () => {
  it('refuses 501 real xlsx data rows before growing an intermediate row matrix', async () => {
    await expect(
      matrixOf((sheet) => {
        for (let row = 2; row <= 502; row += 1) sheet.getCell(row, 1).value = `Synthetic ${row}`;
      }),
    ).rejects.toThrow(new EmployeeImportError('IMPORT_ROW_LIMIT_EXCEEDED'));
  });

  it('ignores a blank at row 300000 with bounded memory and preserves sparse row numbers', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('employees');
    sheet.addRow(HEADERS);
    sheet.getCell(300000, 1).value = ' ';
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const heap = process.memoryUsage().heapUsed;
    const start = performance.now();
    const matrix = await readWorkbookMatrix(bytes);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(process.memoryUsage().heapUsed - heap).toBeLessThan(64 * 1024 * 1024);
    expect(matrix).toHaveLength(1);
    expect(readSheet(matrix, HEADERS, 500)).toBe('IMPORT_HEADER_INVALID');
  });

  it('rejects a 2 MiB+1 file before parsing', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('employees').addRow(HEADERS);
    const bytes = Buffer.alloc(EMPLOYEE_IMPORT_MAX_BYTES + 1);
    Buffer.from(await workbook.xlsx.writeBuffer()).copy(bytes);
    await expect(readWorkbookMatrix(bytes)).rejects.toThrow('IMPORT_FILE_CONTENT_INVALID');
  });

  it.each([
    [null, 'unheaded data'],
    ['', 'unheaded data'],
    [' ', { error: '#DIV/0!' }],
  ] as const)(
    'reports data under an empty header %j instead of discarding it',
    async (header, data) => {
      const matrix = await matrixOf((sheet) => {
        sheet.getCell(1, HEADERS.length + 1).value = header;
        sheet.addRow(['Synthetic', null, 'staff', '2026-01-01', null, 'Main', data]);
      });
      const sheet = readSheet(matrix, HEADERS, 500);
      if (typeof sheet === 'string') throw new Error(sheet);
      expect(
        validateEmployeeImport(sheet, new Map([['main', '00000000-0000-7000-8000-000000000001']])),
      ).toEqual({
        rows: [],
        errors: [{ row: 2, column: 'unexpected_column', code: 'IMPORT_COLUMN_UNEXPECTED' }],
      });
    },
  );
});
