import { describe, expect, it } from 'vitest';

import {
  INVALID_CELL,
  readSheet,
  type ImportCell,
  type ReadSheetResult,
} from '../../../shared/import/import-sheet.ts';
import { EMPLOYEE_IMPORT_HEADERS } from '../domain/employee-import.ts';
import { validateEmployeeImport } from '../use-cases/preview-employee-import/employee-import.validator.ts';

const BRANCHES = new Map([
  ['main', '11111111-1111-7111-8111-111111111111'],
  ['salmiya', '22222222-2222-7222-8222-222222222222'],
  ['الفرع', '22222222-2222-7222-8222-222222222222'],
]);

const sheet = (rows: readonly (readonly ImportCell[])[]): ReadSheetResult => {
  const result = readSheet([[...EMPLOYEE_IMPORT_HEADERS], ...rows], EMPLOYEE_IMPORT_HEADERS, 500);
  if (typeof result === 'string') throw new Error(result);
  return result;
};
const validRow = ['Synthetic employee', null, 'staff', '2026-01-01', null, 'Main'] as const;

describe('validateEmployeeImport', () => {
  it('accepts a valid row and resolves the branch name case-insensitively', () => {
    const { rows, errors } = validateEmployeeImport(sheet([validRow]), BRANCHES);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      {
        row: 2,
        name_en: 'Synthetic employee',
        name_ar: null,
        role_code: 'staff',
        hire_date: '2026-01-01',
        contract_end: null,
        primary_branch_id: '11111111-1111-7111-8111-111111111111',
      },
    ]);
  });

  it('accepts an Arabic branch name, Excel serials, duplicate names and future hires', () => {
    const sheetResult = sheet([
      ['A', null, 'cashier', 45000, '2099-01-01', 'الفرع'],
      ['A', 'موظف', 'cashier', '2026-01-01', null, 'salmiya'],
    ]);
    const { rows, errors } = validateEmployeeImport(sheetResult, BRANCHES);
    expect(errors).toEqual([]);
    expect(rows.map((row) => row.hire_date)).toEqual(['2023-03-15', '2026-01-01']);
    expect(rows[1]?.name_ar).toBe('موظف');
  });
});

describe('validateEmployeeImport named errors', () => {
  it('names a missing cell, an unknown branch, a bad role and a bad date per column', () => {
    const { rows, errors } = validateEmployeeImport(
      sheet([['', null, 'wizard', 'not-a-date', null, 'Alexandria']]),
      BRANCHES,
    );
    expect(rows).toEqual([]);
    expect(errors).toEqual(
      expect.arrayContaining([
        { row: 2, column: 'name_en', code: 'IMPORT_REQUIRED_CELL' },
        { row: 2, column: 'role_code', code: 'IMPORT_ROLE_INVALID' },
        { row: 2, column: 'hire_date', code: 'IMPORT_DATE_INVALID' },
        { row: 2, column: 'primary_branch', code: 'IMPORT_BRANCH_NOT_FOUND' },
      ]),
    );
  });

  it('reuses the create-employee contract-end rule', () => {
    const { rows, errors } = validateEmployeeImport(
      sheet([['Synthetic employee', null, 'staff', '2026-05-01', '2026-04-30', 'main']]),
      BRANCHES,
    );
    expect(rows).toEqual([]);
    expect(errors).toEqual([
      { row: 2, column: 'contract_end', code: 'IMPORT_CONTRACT_END_BEFORE_HIRE' },
    ]);
  });
});

describe('validateEmployeeImport cell and name refusals', () => {
  it('names an unreadable cell as IMPORT_CELL_INVALID', () => {
    const { rows, errors } = validateEmployeeImport(
      sheet([[INVALID_CELL, null, 'staff', '2026-01-01', null, 'main']]),
      BRANCHES,
    );
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ row: 2, column: 'name_en', code: 'IMPORT_CELL_INVALID' }]);
  });

  it('reports a name over 255 characters as an invalid name', () => {
    const { errors } = validateEmployeeImport(
      sheet([['x'.repeat(256), null, 'staff', '2026-01-01', null, 'main']]),
      BRANCHES,
    );
    expect(errors).toEqual([{ row: 2, column: 'name_en', code: 'IMPORT_NAME_INVALID' }]);
  });
});
