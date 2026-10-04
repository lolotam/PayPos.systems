import { createEmployeeInput } from '@pospay/contracts';

import {
  type EmployeeImportColumn,
  type EmployeeImportErrorCode,
  type EmployeeImportRowError,
  type EmployeeImportCandidate,
} from '../../domain/employee-import.ts';
import {
  cellText,
  excelSerialToIsoDate,
  INVALID_CELL,
  isoDateFromText,
  type ImportCell,
  type ReadSheetResult,
} from '../../../../shared/import/import-sheet.ts';
import {
  EmployeeCreationError,
  validateEmployeeCreation,
  type EmployeeRecord,
} from '../../domain/create-employee.ts';

export interface EmployeeImportValidation {
  readonly rows: readonly EmployeeImportCandidate[];
  readonly errors: readonly EmployeeImportRowError[];
}

// UUID وهمي صالح يجعل فحص باقي الحقول يكتمل حتى لو تعذّر مطابقة اسم الفرع.
const UNRESOLVED_BRANCH = '00000000-0000-7000-8000-000000000000';

function cellDate(cell: ImportCell): string | null {
  if (typeof cell === 'number') return excelSerialToIsoDate(cell);
  const value = cellText(cell);
  return value === null ? null : isoDateFromText(value);
}

// يختار أول سبب لكل عمود حتى لا تتكرر رسالة نفس الخلية في الرد.
function push(
  errors: EmployeeImportRowError[],
  row: number,
  column: EmployeeImportColumn,
  code: EmployeeImportErrorCode,
) {
  if (!errors.some((error) => error.row === row && error.column === column))
    errors.push({ row, column, code });
}

interface RawRow {
  readonly row: number;
  readonly nameEn: ImportCell;
  readonly nameAr: ImportCell;
  readonly roleCode: ImportCell;
  readonly hireDate: ImportCell;
  readonly contractEnd: ImportCell;
  readonly primaryBranch: ImportCell;
}

function rawRows(sheet: ReadSheetResult): RawRow[] {
  const index = new Map(sheet.headers.map((header, position) => [header, position]));
  const at = (cells: readonly ImportCell[], header: string): ImportCell =>
    cells[index.get(header) ?? -1] ?? null;
  return sheet.rows.map(({ row, cells }) => ({
    row,
    nameEn: at(cells, 'name_en'),
    nameAr: at(cells, 'name_ar'),
    roleCode: at(cells, 'role_code'),
    hireDate: at(cells, 'hire_date'),
    contractEnd: at(cells, 'contract_end'),
    primaryBranch: at(cells, 'primary_branch'),
  }));
}

function validateRow(
  raw: RawRow,
  branches: ReadonlyMap<string, string>,
  errors: EmployeeImportRowError[],
): EmployeeImportCandidate | null {
  const start = errors.length;
  // خلية تعذّرت قراءتها تُسمّى أولاً؛ push لا تكرّر نفس الصف والعمود فتسبق أي خطأ مشتق منها.
  for (const [column, cell] of [
    ['name_en', raw.nameEn],
    ['name_ar', raw.nameAr],
    ['role_code', raw.roleCode],
    ['hire_date', raw.hireDate],
    ['contract_end', raw.contractEnd],
    ['primary_branch', raw.primaryBranch],
  ] as const)
    if (cell === INVALID_CELL) push(errors, raw.row, column, 'IMPORT_CELL_INVALID');
  const nameEn = cellText(raw.nameEn);
  if (nameEn === null) push(errors, raw.row, 'name_en', 'IMPORT_REQUIRED_CELL');
  const roleRaw = cellText(raw.roleCode);
  if (roleRaw === null) push(errors, raw.row, 'role_code', 'IMPORT_REQUIRED_CELL');
  const hireDate = cellDate(raw.hireDate);
  if (hireDate === null) push(errors, raw.row, 'hire_date', 'IMPORT_DATE_INVALID');
  const contractEnd = cellDate(raw.contractEnd);
  if (cellText(raw.contractEnd) !== null && contractEnd === null)
    push(errors, raw.row, 'contract_end', 'IMPORT_DATE_INVALID');
  const branchName = cellText(raw.primaryBranch);
  if (branchName === null) push(errors, raw.row, 'primary_branch', 'IMPORT_REQUIRED_CELL');
  const branchId = branchName === null ? undefined : branches.get(branchName.toLowerCase());
  if (branchName !== null && branchId === undefined)
    push(errors, raw.row, 'primary_branch', 'IMPORT_BRANCH_NOT_FOUND');
  // نكمل فحص الحقول دائماً حتى تظهر كل الأخطاء، حتى مع خلية مطلوبة ناقصة.
  const candidate = candidateFrom(raw, branchId ?? UNRESOLVED_BRANCH, errors);
  return errors.length > start ? null : candidate;
}

// فحص الحقول بقواعد create-employee (Zod contract) ثم قاعدة المجال عبر validateEmployeeCreation.
function candidateFrom(
  raw: RawRow,
  branchId: string,
  errors: EmployeeImportRowError[],
): EmployeeImportCandidate | null {
  const parsed = createEmployeeInput.safeParse({
    primary_branch_id: branchId,
    name_en: cellText(raw.nameEn) ?? '',
    name_ar: cellText(raw.nameAr),
    role_code: cellText(raw.roleCode) ?? '',
    hire_date: cellDate(raw.hireDate) ?? '',
    contract_end: cellDate(raw.contractEnd),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'name_en' || field === 'name_ar')
        push(errors, raw.row, field, 'IMPORT_NAME_INVALID');
      else if (field === 'role_code') push(errors, raw.row, 'role_code', 'IMPORT_ROLE_INVALID');
      else if (field === 'hire_date' || field === 'contract_end')
        push(errors, raw.row, field, 'IMPORT_DATE_INVALID');
    }
    return null;
  }
  const record: EmployeeRecord = {
    id: UNRESOLVED_BRANCH,
    business_id: '',
    primary_branch_id: branchId,
    name_ar: parsed.data.name_ar ?? null,
    name_en: parsed.data.name_en,
    role_code: parsed.data.role_code,
    hire_date: parsed.data.hire_date,
    contract_end: parsed.data.contract_end ?? null,
    user_id: null,
    created_at: '',
  };
  try {
    validateEmployeeCreation(record, { businessExists: true, branchBusinessId: '' });
  } catch (error) {
    if (error instanceof EmployeeCreationError && error.code === 'EMPLOYEE_CONTRACT_END_BEFORE_HIRE') {
      push(errors, raw.row, 'contract_end', 'IMPORT_CONTRACT_END_BEFORE_HIRE');
      return null;
    }
    throw error;
  }
  return {
    row: raw.row,
    name_en: record.name_en,
    name_ar: record.name_ar,
    role_code: record.role_code,
    hire_date: record.hire_date,
    contract_end: record.contract_end,
    primary_branch_id: branchId,
  };
}

/**
 * بيتحقق من كل صف وخلية في ورقة الموظفين بنفس قواعد create-employee، وبيرجّع الصفوف السليمة والأخطاء المسمّاة.
 *
 * @param sheet الورقة بعد فحص العناوين وحد الصفوف
 * @param branches خريطة اسم الفرع (إنجليزي أو عربي، بحروف صغيرة) إلى معرفه داخل النشاط
 * @returns الصفوف الجاهزة وأخطاء الصفوف والcolumns
 */
export function validateEmployeeImport(
  sheet: ReadSheetResult,
  branches: ReadonlyMap<string, string>,
): EmployeeImportValidation {
  const errors: EmployeeImportRowError[] = [];
  const rows: EmployeeImportCandidate[] = [];
  for (const raw of rawRows(sheet)) {
    const candidate = validateRow(raw, branches, errors);
    if (candidate !== null) rows.push(candidate);
  }
  return { rows, errors };
}
