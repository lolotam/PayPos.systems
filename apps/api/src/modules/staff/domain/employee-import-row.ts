import {
  type EmployeeImportColumn,
  type EmployeeImportErrorCode,
  type EmployeeImportRowError,
  type EmployeeImportCandidate,
} from './employee-import.ts';
import {
  cellText,
  cellDate,
  INVALID_CELL,
  type ImportCell,
  type ReadSheetResult,
} from './employee-import-cells.ts';
import {
  EmployeeCreationError,
  validateEmployeeCreation,
  type EmployeeRecord,
} from './create-employee.ts';

export interface EmployeeImportValidation {
  readonly rows: readonly EmployeeImportCandidate[];
  readonly errors: readonly EmployeeImportRowError[];
}

// UUID وهمي صالح يجعل فحص باقي الحقول يكتمل حتى لو تعذّر مطابقة اسم الفرع.
const UNRESOLVED_BRANCH = '00000000-0000-7000-8000-000000000000';

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
  parsed: ImportContractValidation,
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
  const candidate = candidateFrom(raw, branchId ?? UNRESOLVED_BRANCH, errors, parsed);
  return errors.length > start ? null : candidate;
}

// فحص الحقول بقواعد create-employee (Zod contract) ثم قاعدة المجال عبر validateEmployeeCreation.
function candidateFrom(
  raw: RawRow,
  branchId: string,
  errors: EmployeeImportRowError[],
  parsed: ImportContractValidation,
): EmployeeImportCandidate | null {
  if (!parsed.success) {
    for (const issue of parsed.issues) {
      const field = issue;
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
    if (
      error instanceof EmployeeCreationError &&
      error.code === 'EMPLOYEE_CONTRACT_END_BEFORE_HIRE'
    ) {
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
 * @param validations نتائج عقد الإنشاء كقيم أولية دون استيراد Zod في المجال
 * @returns الصفوف الجاهزة وأخطاء الصفوف والcolumns
 */
export function validateEmployeeImport(
  sheet: ReadSheetResult,
  branches: ReadonlyMap<string, string>,
  validations: readonly ImportContractValidation[],
): EmployeeImportValidation {
  const errors: EmployeeImportRowError[] = [];
  const rows: EmployeeImportCandidate[] = [];
  for (const [index, raw] of rawRows(sheet).entries()) {
    if (
      sheet.rows[index]?.cells
        .slice(sheet.headers.length)
        .some((cell) => cell === INVALID_CELL || cellText(cell) !== null)
    )
      push(errors, raw.row, 'unexpected_column', 'IMPORT_COLUMN_UNEXPECTED');
    const candidate = validateRow(
      raw,
      branches,
      errors,
      validations[index] ?? { success: false, issues: ['name_en'] },
    );
    if (candidate !== null && !errors.some((error) => error.row === raw.row)) rows.push(candidate);
  }
  return { rows, errors };
}

/** نتيجة العقد كقيم أولية؛ المجال يسمي الأخطاء ولا يعتمد على Zod. */
export type ImportContractValidation =
  | { readonly success: false; readonly issues: readonly string[] }
  | { readonly success: true; readonly data: Omit<EmployeeImportCandidate, 'row'> };

/**
 * يجهز قيم عقد الإنشاء بقواعد تواريخ وملكية فروع الاستيراد الصافية.
 *
 * @param sheet الورقة ذات العناوين المرجعية
 * @param branches خريطة الفروع الموجودة
 * @returns مدخلات عقد الإنشاء دون أي اعتماد على مكتبة التحقق
 */
export function employeeImportInputs(
  sheet: ReadSheetResult,
  branches: ReadonlyMap<string, string>,
) {
  return rawRows(sheet).map((raw) => {
    const branchId =
      branches.get(cellText(raw.primaryBranch)?.toLowerCase() ?? '') ?? UNRESOLVED_BRANCH;
    return {
      primary_branch_id: branchId,
      name_en: cellText(raw.nameEn) ?? '',
      name_ar: cellText(raw.nameAr),
      role_code: cellText(raw.roleCode) ?? '',
      hire_date: cellDate(raw.hireDate) ?? '',
      contract_end: cellDate(raw.contractEnd),
    };
  });
}
